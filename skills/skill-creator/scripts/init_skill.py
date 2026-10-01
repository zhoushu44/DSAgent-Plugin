#!/usr/bin/env python3
"""
Skill Initializer - Creates a new QIWork workspace skill from template.

Usage:
    init_skill.py <skill-name> --path <path> [--resources scripts,references,assets] [--examples]

Examples:
    init_skill.py my-new-skill --path ~/.QIWork/users/{uid}/workspaces/{aid}/skills
    init_skill.py my-new-skill --path ./skills --resources scripts,references
    init_skill.py my-api-helper --path ./skills --resources scripts --examples
"""

import argparse
import re
import sys
from pathlib import Path

MAX_SKILL_NAME_LENGTH = 64
ALLOWED_RESOURCES = {"scripts", "references", "assets"}

SKILL_TEMPLATE = """---
name: {skill_name}
description: [TODO: Complete and informative explanation of what the skill does and when to use it. Include WHEN to use this skill - specific scenarios, file types, or tasks that trigger it.]
metadata:
  requires:
    bins: []
    env: []
---

# {skill_title}

## Overview

[TODO: 1-2 sentences explaining what this skill enables]

## Structuring This Skill

[TODO: Choose the structure that best fits this skill's purpose. Common patterns:

**1. Workflow-Based** (best for sequential processes)
- Works well when there are clear step-by-step procedures
- Example: DOCX skill with "Workflow Decision Tree" -> "Reading" -> "Creating" -> "Editing"
- Structure: ## Overview -> ## Workflow Decision Tree -> ## Step 1 -> ## Step 2...

**2. Task-Based** (best for tool collections)
- Works well when the skill offers different operations/capabilities
- Example: PDF skill with "Quick Start" -> "Merge PDFs" -> "Split PDFs" -> "Extract Text"
- Structure: ## Overview -> ## Quick Start -> ## Task Category 1 -> ## Task Category 2...

**3. Reference/Guidelines** (best for standards or specifications)
- Works well for brand guidelines, coding standards, or requirements
- Structure: ## Overview -> ## Guidelines -> ## Specifications -> ## Usage...

**4. Capabilities-Based** (best for integrated systems)
- Structure: ## Overview -> ## Core Capabilities -> ### 1. Feature -> ### 2. Feature...

Delete this entire "Structuring This Skill" section when done - it's just guidance.]

## [TODO: Replace with the first main section based on chosen structure]

[TODO: Add content here. See examples in existing skills:
- Code samples for technical skills
- Decision trees for complex workflows
- Concrete examples with realistic user requests
- References to scripts/templates/references as needed]

## Resources (optional)

Create only the resource directories this skill actually needs. Delete this section if no resources are required.

### scripts/
Executable code (Python/Bash/etc.) that can be run directly to perform specific operations.

### references/
Documentation intended to be loaded into context when needed.

### assets/
Files used in output (templates, images, fonts, etc.) — not loaded into context.

**Not every skill requires all three types of resources.**
"""

EXAMPLE_SCRIPT = '''#!/usr/bin/env python3
"""
Example helper script for {skill_name}

Replace with actual implementation or delete if not needed.
"""

def main():
    print("This is an example script for {skill_name}")

if __name__ == "__main__":
    main()
'''

EXAMPLE_REFERENCE = """# Reference Documentation for {skill_title}

Replace with actual reference content or delete if not needed.

Reference docs are ideal for:
- Comprehensive API documentation
- Detailed workflow guides
- Complex multi-step processes
- Information too lengthy for main SKILL.md
"""

EXAMPLE_ASSET = """# Example Asset File

Replace with actual asset files (templates, images, fonts, etc.) or delete if not needed.

Asset files are NOT intended to be loaded into context.
"""


def normalize_skill_name(skill_name):
    """Normalize a skill name to lowercase hyphen-case."""
    normalized = skill_name.strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    normalized = normalized.strip("-")
    normalized = re.sub(r"-{2,}", "-", normalized)
    return normalized


def title_case_skill_name(skill_name):
    """Convert hyphenated skill name to Title Case for display."""
    return " ".join(word.capitalize() for word in skill_name.split("-"))


def parse_resources(raw_resources):
    if not raw_resources:
        return []
    resources = [item.strip() for item in raw_resources.split(",") if item.strip()]
    invalid = sorted({item for item in resources if item not in ALLOWED_RESOURCES})
    if invalid:
        allowed = ", ".join(sorted(ALLOWED_RESOURCES))
        print(f"[ERROR] Unknown resource type(s): {', '.join(invalid)}")
        print(f"   Allowed: {allowed}")
        sys.exit(1)
    deduped = []
    seen = set()
    for resource in resources:
        if resource not in seen:
            deduped.append(resource)
            seen.add(resource)
    return deduped


def create_resource_dirs(skill_dir, skill_name, skill_title, resources, include_examples):
    for resource in resources:
        resource_dir = skill_dir / resource
        resource_dir.mkdir(exist_ok=True)
        if resource == "scripts":
            if include_examples:
                example_script = resource_dir / "example.py"
                example_script.write_text(EXAMPLE_SCRIPT.format(skill_name=skill_name))
                example_script.chmod(0o755)
                print("[OK] Created scripts/example.py")
            else:
                print("[OK] Created scripts/")
        elif resource == "references":
            if include_examples:
                example_reference = resource_dir / "api_reference.md"
                example_reference.write_text(
                    EXAMPLE_REFERENCE.format(skill_title=skill_title),
                )
                print("[OK] Created references/api_reference.md")
            else:
                print("[OK] Created references/")
        elif resource == "assets":
            if include_examples:
                example_asset = resource_dir / "example_asset.txt"
                example_asset.write_text(EXAMPLE_ASSET)
                print("[OK] Created assets/example_asset.txt")
            else:
                print("[OK] Created assets/")


def init_skill(skill_name, path, resources, include_examples):
    """Initialize a new skill directory with template SKILL.md."""
    skill_dir = Path(path).expanduser().resolve() / skill_name

    if skill_dir.exists():
        print(f"[ERROR] Skill directory already exists: {skill_dir}")
        return None

    try:
        skill_dir.mkdir(parents=True, exist_ok=False)
        print(f"[OK] Created skill directory: {skill_dir}")
    except Exception as e:
        print(f"[ERROR] Error creating directory: {e}")
        return None

    skill_title = title_case_skill_name(skill_name)
    skill_content = SKILL_TEMPLATE.format(
        skill_name=skill_name,
        skill_title=skill_title,
    )

    skill_md_path = skill_dir / "SKILL.md"
    try:
        skill_md_path.write_text(skill_content)
        print("[OK] Created SKILL.md")
    except Exception as e:
        print(f"[ERROR] Error creating SKILL.md: {e}")
        return None

    if resources:
        try:
            create_resource_dirs(
                skill_dir,
                skill_name,
                skill_title,
                resources,
                include_examples,
            )
        except Exception as e:
            print(f"[ERROR] Error creating resource directories: {e}")
            return None

    print(f"\n[OK] Skill '{skill_name}' initialized successfully at {skill_dir}")
    print("\nNext steps:")
    print("1. Edit SKILL.md — complete TODOs and write a strong description")
    if resources:
        if include_examples:
            print("2. Customize or delete example files in scripts/, references/, assets/")
        else:
            print("2. Add resources to scripts/, references/, and assets/ as needed")
    else:
        print("2. Create resource directories only if needed")
    print("3. Enable the skill in Console → Skills → Installed, or edit skill.json")
    print("4. Run: python scripts/quick_validate.py <skill_dir>")

    return skill_dir


def main():
    parser = argparse.ArgumentParser(
        description="Create a new QIWork workspace skill directory with SKILL.md.",
    )
    parser.add_argument("skill_name", help="Skill name (normalized to hyphen-case)")
    parser.add_argument(
        "--path",
        required=True,
        help="Output directory (typically <workspace>/skills)",
    )
    parser.add_argument(
        "--resources",
        default="",
        help="Comma-separated list: scripts,references,assets",
    )
    parser.add_argument(
        "--examples",
        action="store_true",
        help="Create example files inside resource directories",
    )
    args = parser.parse_args()

    raw_skill_name = args.skill_name
    skill_name = normalize_skill_name(raw_skill_name)
    if not skill_name:
        print("[ERROR] Skill name must include at least one letter or digit.")
        sys.exit(1)
    if len(skill_name) > MAX_SKILL_NAME_LENGTH:
        print(
            f"[ERROR] Skill name '{skill_name}' is too long ({len(skill_name)} characters). "
            f"Maximum is {MAX_SKILL_NAME_LENGTH} characters.",
        )
        sys.exit(1)
    if skill_name != raw_skill_name:
        print(f"Note: Normalized skill name from '{raw_skill_name}' to '{skill_name}'.")

    resources = parse_resources(args.resources)
    if args.examples and not resources:
        print("[ERROR] --examples requires --resources to be set.")
        sys.exit(1)

    print(f"Initializing skill: {skill_name}")
    print(f"   Location: {args.path}")
    if resources:
        print(f"   Resources: {', '.join(resources)}")
    print()

    result = init_skill(skill_name, args.path, resources, args.examples)
    sys.exit(0 if result else 1)


if __name__ == "__main__":
    main()
