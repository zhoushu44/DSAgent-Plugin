"""
Excel Formula Recalculation Script
Recalculates all formulas in an Excel file using LibreOffice
"""

import json
import os
import platform
import subprocess
import sys
import tempfile
from pathlib import Path

from office.soffice import get_soffice_cmd, get_soffice_env

from openpyxl import load_workbook


def _run_no_pipe(
    cmd: list[str], timeout: float | None = None, text: bool = True,
    cwd: str | None = None, env: dict | None = None,
) -> subprocess.CompletedProcess:
    """受限沙箱（DSH workspace-write）禁止创建匿名管道，
    因此不能用 capture_output=True；改为临时文件承接子进程 stdout/stderr，语义等价。"""
    if text:
        out_f = tempfile.NamedTemporaryFile(mode="w", suffix=".out", delete=False, encoding="utf-8", errors="replace", newline="")
        err_f = tempfile.NamedTemporaryFile(mode="w", suffix=".err", delete=False, encoding="utf-8", errors="replace", newline="")
    else:
        out_f = tempfile.NamedTemporaryFile(mode="wb", suffix=".out", delete=False)
        err_f = tempfile.NamedTemporaryFile(mode="wb", suffix=".err", delete=False)
    paths = (out_f.name, err_f.name)
    try:
        try:
            proc = subprocess.run(cmd, stdout=out_f, stderr=err_f, timeout=timeout, cwd=cwd, env=env)
        finally:
            out_f.close()
            err_f.close()
        if text:
            with open(paths[0], encoding="utf-8", errors="replace") as f:
                out = f.read()
            with open(paths[1], encoding="utf-8", errors="replace") as f:
                err = f.read()
        else:
            with open(paths[0], "rb") as f:
                out = f.read()
            with open(paths[1], "rb") as f:
                err = f.read()
        return subprocess.CompletedProcess(cmd, proc.returncode, out, err)
    finally:
        for p in paths:
            try:
                os.unlink(p)
            except OSError:
                pass


MACRO_DIR_MACOS = "~/Library/Application Support/LibreOffice/4/user/basic/Standard"
MACRO_DIR_LINUX = "~/.config/libreoffice/4/user/basic/Standard"
MACRO_DIR_WINDOWS = "~/AppData/Roaming/LibreOffice/4/user/basic/Standard"
MACRO_FILENAME = "Module1.xba"

RECALCULATE_MACRO = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE script:module PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "module.dtd">
<script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module1" script:language="StarBasic">
    Sub RecalculateAndSave()
      ThisComponent.calculateAll()
      ThisComponent.store()
      ThisComponent.close(True)
    End Sub
</script:module>"""


def has_gtimeout():
    try:
        _run_no_pipe(
            ["gtimeout", "--version"], timeout=1, text=False
        )
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _get_macro_dir() -> str:
    """Return the LibreOffice macro directory for the current platform."""
    system = platform.system()
    if system == "Darwin":
        return MACRO_DIR_MACOS
    elif system == "Windows":
        return MACRO_DIR_WINDOWS
    else:
        return MACRO_DIR_LINUX


def setup_libreoffice_macro():
    macro_dir = os.path.expanduser(_get_macro_dir())
    macro_file = os.path.join(macro_dir, MACRO_FILENAME)

    if (
        os.path.exists(macro_file)
        and "RecalculateAndSave" in Path(macro_file).read_text()
    ):
        return True

    if not os.path.exists(macro_dir):
        _run_no_pipe(
            [get_soffice_cmd(), "--headless", "--terminate_after_init"],
            timeout=10,
            env=get_soffice_env(),
            text=False,
        )
        os.makedirs(macro_dir, exist_ok=True)

    try:
        Path(macro_file).write_text(RECALCULATE_MACRO)
        return True
    except Exception:
        return False


def recalc(filename, timeout=30):
    if not Path(filename).exists():
        return {"error": f"File {filename} does not exist"}

    abs_path = str(Path(filename).absolute())

    if not setup_libreoffice_macro():
        return {"error": "Failed to setup LibreOffice macro"}

    cmd = [
        get_soffice_cmd(),
        "--headless",
        "--norestore",
        "vnd.sun.star.script:Standard.Module1.RecalculateAndSave?language=Basic&location=application",
        abs_path,
    ]

    system = platform.system()
    if system == "Linux":
        cmd = ["timeout", str(timeout)] + cmd
    elif system == "Darwin" and has_gtimeout():
        cmd = ["gtimeout", str(timeout)] + cmd
    # On Windows, rely on subprocess timeout parameter instead of external tool

    try:
        result = _run_no_pipe(
            cmd,
            env=get_soffice_env(),
            timeout=timeout if system == "Windows" else None,
        )
    except subprocess.TimeoutExpired:
        return {
            "error": (
                f"LibreOffice recalculation timed out after {timeout} seconds"
            ),
        }

    if result.returncode != 0 and result.returncode != 124:  
        error_msg = result.stderr or "Unknown error during recalculation"
        if "Module1" in error_msg or "RecalculateAndSave" not in error_msg:
            return {"error": "LibreOffice macro not configured properly"}
        return {"error": error_msg}

    try:
        wb = load_workbook(filename, data_only=True)

        excel_errors = [
            "#VALUE!",
            "#DIV/0!",
            "#REF!",
            "#NAME?",
            "#NULL!",
            "#NUM!",
            "#N/A",
        ]
        error_details = {err: [] for err in excel_errors}
        total_errors = 0

        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            for row in ws.iter_rows():
                for cell in row:
                    if cell.value is not None and isinstance(cell.value, str):
                        for err in excel_errors:
                            if err in cell.value:
                                location = f"{sheet_name}!{cell.coordinate}"
                                error_details[err].append(location)
                                total_errors += 1
                                break

        wb.close()

        result = {
            "status": "success" if total_errors == 0 else "errors_found",
            "total_errors": total_errors,
            "error_summary": {},
        }

        for err_type, locations in error_details.items():
            if locations:
                result["error_summary"][err_type] = {
                    "count": len(locations),
                    "locations": locations[:20],  
                }

        wb_formulas = load_workbook(filename, data_only=False)
        formula_count = 0
        for sheet_name in wb_formulas.sheetnames:
            ws = wb_formulas[sheet_name]
            for row in ws.iter_rows():
                for cell in row:
                    if (
                        cell.value
                        and isinstance(cell.value, str)
                        and cell.value.startswith("=")
                    ):
                        formula_count += 1
        wb_formulas.close()

        result["total_formulas"] = formula_count

        return result

    except Exception as e:
        return {"error": str(e)}


def main():
    if len(sys.argv) < 2:
        print("Usage: python recalc.py <excel_file> [timeout_seconds]")
        print("\nRecalculates all formulas in an Excel file using LibreOffice")
        print("\nReturns JSON with error details:")
        print("  - status: 'success' or 'errors_found'")
        print("  - total_errors: Total number of Excel errors found")
        print("  - total_formulas: Number of formulas in the file")
        print("  - error_summary: Breakdown by error type with locations")
        print("    - #VALUE!, #DIV/0!, #REF!, #NAME?, #NULL!, #NUM!, #N/A")
        sys.exit(1)

    filename = sys.argv[1]
    timeout = int(sys.argv[2]) if len(sys.argv) > 2 else 30

    result = recalc(filename, timeout)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
