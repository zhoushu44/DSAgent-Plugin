"""报告布局 CSS：参考样例结构 + 蓝白渐变配色（competitor-indicator 风格）。"""

REFERENCE_CSS = """
  :root {
    --bg: #eef4fb;
    --bg-deep: #e3edf9;
    --card: rgba(255, 255, 255, 0.96);
    --text: #1e293b;
    --muted: #64748b;
    --line: #d4e3f4;
    --blue: #2563eb;
    --blue-deep: #1d4ed8;
    --blue-bg: #eff6ff;
    --blue-soft: #dbeafe;
    --orange: #ea580c;
    --orange-deep: #c2410c;
    --orange-bg: #fff7ed;
    --green: #059669;
    --green-bg: #ecfdf5;
    --red: #dc2626;
    --red-bg: #fef2f2;
    --gray-bg: #f1f5f9;
    --chip: #eff6ff;
    --shadow: 0 18px 48px rgba(37, 99, 235, 0.1);
    --shadow-sm: 0 1px 2px rgba(37, 99, 235, 0.06), 0 1px 3px rgba(37, 99, 235, 0.08);
    --radius: 16px;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    background:
      radial-gradient(circle at top left, rgba(37, 99, 235, 0.12), transparent 28%),
      radial-gradient(circle at right 12%, rgba(96, 165, 250, 0.14), transparent 20%),
      linear-gradient(180deg, #ffffff 0%, var(--bg) 46%, var(--bg-deep) 100%);
    color: var(--text);
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, sans-serif;
    line-height: 1.65;
    font-size: 14px;
  }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 24px 20px 60px; }
  header.hero {
    background: var(--card);
    color: var(--text);
    border: 1px solid rgba(212, 227, 244, 0.95);
    border-radius: 24px;
    padding: 28px 32px 24px;
    margin-bottom: 20px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(8px);
    position: relative;
    overflow: hidden;
  }
  header.hero::after {
    content: "";
    position: absolute; right: -60px; bottom: -80px;
    width: 220px; height: 220px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(37, 99, 235, 0.16), transparent 66%);
    pointer-events: none;
  }
  .hero-top {
    display: flex; justify-content: space-between; align-items: center;
    gap: 14px; flex-wrap: wrap; position: relative; z-index: 1; margin-bottom: 12px;
  }
  .eyebrow {
    display: inline-flex; padding: 6px 12px; border-radius: 999px;
    background: var(--blue-soft); color: var(--blue-deep);
    font-size: 12px; letter-spacing: 0.06em;
  }
  .generated-at { font-size: 12px; color: var(--muted); white-space: nowrap; }
  header.hero h1 {
    margin: 0 0 6px; font-size: 24px; font-weight: 700; letter-spacing: 0.01em;
    font-family: "Iowan Old Style", "Noto Serif SC", "Songti SC", serif;
    position: relative; z-index: 1;
  }
  header.hero .sub { color: var(--muted); font-size: 13px; position: relative; z-index: 1; }
  .meta-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; position: relative; z-index: 1; }
  .meta-chip {
    background: rgba(255, 255, 255, 0.82);
    border: 1px solid rgba(212, 227, 244, 0.95);
    border-radius: 10px;
    padding: 7px 14px;
    font-size: 13px;
  }
  .meta-chip b { font-weight: 600; color: var(--text); }
  .meta-chip.hl { background: var(--blue-bg); border-color: #bfdbfe; }
  section { margin-bottom: 22px; }
  .card {
    background: var(--card);
    border: 1px solid rgba(212, 227, 244, 0.95);
    border-radius: 24px;
    padding: 22px 24px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(8px);
  }
  h2.sec-title {
    font-size: 18px;
    margin: 0 0 16px;
    padding-left: 12px;
    border-left: 4px solid var(--blue);
    line-height: 1.3;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: "Iowan Old Style", "Noto Serif SC", "Songti SC", serif;
  }
  h2.sec-title .sec-no {
    font-size: 12px; font-weight: 700; color: #fff; background: var(--blue-deep);
    border-radius: 999px; padding: 2px 10px; margin-left: 4px;
    font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  h3.block-title { font-size: 15px; margin: 18px 0 10px; }
  .obj-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .obj-card { border-radius: 16px; padding: 16px 18px; border: 1px solid var(--line); position: relative; }
  .obj-card.mine { background: linear-gradient(180deg, #ffffff 0%, var(--blue-bg) 100%); border-color: #bfdbfe; }
  .obj-card.rival { background: linear-gradient(180deg, #ffffff 0%, var(--orange-bg) 100%); border-color: #fed7aa; }
  .obj-tag {
    display: inline-block; font-size: 12px; font-weight: 700; padding: 2px 12px;
    border-radius: 20px; color: #fff; margin-bottom: 8px; letter-spacing: .5px;
  }
  .obj-tag.mine { background: var(--blue); }
  .obj-tag.rival { background: var(--orange); }
  .obj-name { font-size: 14px; font-weight: 600; margin: 0 0 6px; line-height: 1.45; }
  .obj-id { font-size: 12px; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .obj-card .vs-legend { margin-top: 10px; font-size: 12px; color: var(--muted); display: flex; gap: 14px; flex-wrap: wrap; }
  .vs-legend .lg { display: inline-flex; align-items: center; gap: 5px; }
  .vs-legend .sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  .sw.mine { background: var(--blue); }
  .sw.rival { background: var(--orange); }
  .sw.good { background: var(--green); }
  .sw.bad { background: var(--red); }
  .concl { list-style: none; padding: 0; margin: 0; }
  .concl li { position: relative; padding: 9px 0 9px 28px; border-bottom: 1px dashed var(--line); font-size: 13.5px; }
  .concl li:last-child { border-bottom: none; }
  .concl li::before { content: "◆"; position: absolute; left: 6px; top: 10px; font-size: 10px; color: var(--blue); }
  .tag {
    display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 9px;
    border-radius: 4px; margin-right: 7px; vertical-align: 1px; white-space: nowrap;
  }
  .tag.good { background: var(--green-bg); color: var(--green); }
  .tag.bad { background: var(--red-bg); color: var(--red); }
  .tag.blue { background: var(--blue-soft); color: var(--blue-deep); }
  .tag.orange { background: var(--orange-bg); color: var(--orange); }
  .tag.gray { background: var(--gray-bg); color: var(--muted); }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 6px; }
  .kpi {
    background: linear-gradient(180deg, #ffffff 0%, rgba(239, 246, 255, 0.72) 100%);
    border: 1px solid rgba(212, 227, 244, 0.95);
    border-radius: 16px;
    padding: 14px 16px;
    box-shadow: var(--shadow-sm);
  }
  .kpi .k-name { font-size: 12px; color: var(--muted); margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
  .kpi .k-diff { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 20px; }
  .k-diff.up { background: var(--green-bg); color: var(--green); }
  .k-diff.down { background: var(--red-bg); color: var(--red); }
  .k-diff.neu { background: var(--gray-bg); color: var(--muted); }
  .kpi .k-values { display: flex; flex-direction: column; gap: 5px; }
  .kpi .kv { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
  .kpi .kv .who { font-size: 11px; width: 34px; flex-shrink: 0; }
  .kpi .kv .who.mine { color: var(--blue); font-weight: 700; }
  .kpi .kv .who.rival { color: var(--orange); font-weight: 700; }
  .kpi .kv .val { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .kpi .kv .val.mine { color: var(--blue-deep); }
  .kpi .kv .val.rival { color: var(--orange-deep); }
  .tbl-wrap {
    overflow-x: auto; margin: 12px 0 6px;
    border: 1px solid rgba(212, 227, 244, 0.95);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.94);
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 640px; }
  th, td { border-bottom: 1px solid rgba(226, 232, 240, 0.95); padding: 9px 12px; text-align: left; vertical-align: middle; }
  thead th {
    background: var(--chip); font-weight: 600; white-space: nowrap; position: sticky; top: 0;
    font-size: 12.5px; color: #475569; letter-spacing: .2px;
  }
  thead th.group-mine { background: var(--blue-bg); color: var(--blue-deep); }
  thead th.group-rival { background: var(--orange-bg); color: var(--orange-deep); }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover td { background: rgba(239, 246, 255, 0.55); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.c-mine { color: var(--blue-deep); font-weight: 600; text-align: right; }
  td.c-rival { color: var(--orange-deep); font-weight: 600; text-align: right; }
  .diff-up { color: var(--green); font-weight: 700; }
  .diff-down { color: var(--red); font-weight: 700; }
  .diff-neu { color: var(--muted); font-weight: 600; }
  .arrow { font-style: normal; }
  .footnote { font-size: 12px; color: var(--muted); margin-top: 8px; }
  .diagnosis {
    margin-top: 14px; padding: 14px 16px;
    border: 1px solid rgba(37, 99, 235, 0.18);
    border-left: 4px solid var(--blue);
    border-radius: 0 16px 16px 0;
    background: linear-gradient(135deg, rgba(239, 246, 255, 0.95), rgba(255, 255, 255, 0.98));
    font-size: 13px; color: var(--text);
  }
  .diagnosis.blue { border-left-color: var(--blue); }
  .channel {
    border: 1px solid rgba(212, 227, 244, 0.95);
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.94);
    padding: 20px 22px; margin-top: 16px;
    box-shadow: var(--shadow-sm);
  }
  .channel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .channel-badge {
    font-size: 12px; font-weight: 700; color: #fff; border-radius: 999px; padding: 3px 12px; letter-spacing: 1px;
  }
  .channel-badge.kw { background: var(--blue-deep); }
  .channel-badge.aud { background: #6366f1; }
  .channel-badge.whole { background: #0891b2; }
  .channel-badge.other { background: #64748b; }
  .channel-head h3 { margin: 0; font-size: 16px; }
  .channel-sub { font-size: 12.5px; color: var(--muted); margin: 0 0 10px; }
  .split-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
  .plan-block {
    border: 1px solid rgba(212, 227, 244, 0.95);
    border-radius: 16px; padding: 14px 16px;
    background: rgba(255, 255, 255, 0.88);
  }
  .plan-block h4 { margin: 0 0 10px; font-size: 13px; display: flex; align-items: center; gap: 7px; }
  .plan-block h4 .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .dot.mine { background: var(--blue); box-shadow: 0 0 0 3px var(--blue-bg); }
  .dot.rival { background: var(--orange); box-shadow: 0 0 0 3px var(--orange-bg); }
  .plan-block table { min-width: 520px; font-size: 12.5px; }
  .no-data {
    background: rgba(248, 250, 255, 0.72); color: var(--muted); border-radius: 12px;
    padding: 20px 14px; text-align: center; font-size: 13px;
    border: 1px dashed rgba(212, 227, 244, 0.95);
  }
  .judge {
    margin-top: 14px; padding: 11px 15px;
    background: rgba(239, 246, 255, 0.65);
    border-left: 3px solid var(--blue);
    border-radius: 0 12px 12px 0;
    font-size: 13px; color: var(--text);
  }
  .plan-list { margin: 0; padding-left: 0; list-style: none; font-size: 13px; }
  .plan-list li { padding: 6px 0 6px 20px; position: relative; border-bottom: 1px dashed var(--line); }
  .plan-list li:last-child { border-bottom: none; }
  .plan-list li::before { content: "▸"; position: absolute; left: 4px; color: var(--muted); }
  .plan-list .ch-tag { display: inline-block; font-size: 11px; padding: 0 7px; border-radius: 4px; margin-right: 6px; font-weight: 600; }
  .ch-tag.kw { background: var(--blue-soft); color: var(--blue-deep); }
  .ch-tag.aud { background: #e0e7ff; color: #4338ca; }
  .ch-tag.whole { background: #cffafe; color: #0e7490; }
  .ch-tag.other { background: var(--gray-bg); color: var(--muted); }
  .advice {
    display: grid; grid-template-columns: 54px 1fr; gap: 16px;
    padding: 16px 18px;
    border: 1px solid rgba(212, 227, 244, 0.95);
    border-radius: 16px; margin-bottom: 12px;
    background: linear-gradient(180deg, #ffffff 0%, rgba(239, 246, 255, 0.55) 100%);
    box-shadow: var(--shadow-sm);
  }
  .advice .no {
    width: 54px; height: 54px; border-radius: 50%; font-weight: 700; font-size: 18px;
    display: flex; align-items: center; justify-content: center;
    background: var(--blue-soft); color: var(--blue-deep);
  }
  .advice .no.p1 { background: var(--red-bg); color: var(--red); }
  .advice .no.p2 { background: var(--orange-bg); color: var(--orange); }
  .advice h4 { margin: 0 0 8px; font-size: 14.5px; }
  .advice .prio { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 4px; padding: 1px 8px; margin-left: 8px; vertical-align: 1px; }
  .prio.p1 { background: var(--red-bg); color: var(--red); }
  .prio.p2 { background: var(--orange-bg); color: var(--orange); }
  .prio.p3 { background: var(--gray-bg); color: var(--muted); }
  .advice p { margin: 5px 0; font-size: 13px; }
  .advice .lab { display: inline-block; width: 72px; color: var(--muted); font-size: 12px; font-weight: 600; }
  footer {
    text-align: center; color: var(--muted); font-size: 12px;
    margin-top: 26px; padding-top: 16px; border-top: 1px solid var(--line);
  }
  @media (max-width: 960px) {
    .kpi-grid { grid-template-columns: repeat(2, 1fr); }
    .obj-grid, .split-grid { grid-template-columns: 1fr; }
    .wrap { padding: 14px 12px 40px; }
    header.hero { padding: 22px 20px; }
    header.hero h1 { font-size: 20px; }
    th, td { padding: 7px 9px; font-size: 12px; }
    .card { padding: 16px; }
  }
  @media (max-width: 520px) { .kpi-grid { grid-template-columns: 1fr; } }
  @media print {
    body { background: #fff; font-size: 12px; }
    .card, .channel, .advice, .kpi { box-shadow: none; }
    header.hero { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    section, .channel, .advice, .kpi { page-break-inside: avoid; }
    .tbl-wrap { overflow: visible; }
    table { min-width: 0; }
  }
"""
