export const EXPORT_CSS = `
.export-page {
  box-sizing: border-box;
  width: 794px;
  padding: 48px 56px;
  background: #ffffff;
  color: #232321;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 15px;
  line-height: 1.75;
}
.export-title {
  margin: 0 0 26px;
  color: #161616;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: -0.02em;
}
.export-body { word-break: break-word; }
.export-body > :first-child { margin-top: 0; }
.export-body p { margin: 0.5em 0; }
.export-body h1, .export-body h2, .export-body h3, .export-body h4, .export-body h5, .export-body h6 {
  margin: 1.35em 0 0.5em;
  color: #161616;
  font-weight: 650;
  line-height: 1.35;
  break-after: avoid;
}
.export-body h1 { font-size: 26px; }
.export-body h2 { font-size: 21px; }
.export-body h3 { font-size: 18px; }
.export-body h4 { font-size: 16px; }
.export-body h5 { font-size: 14.5px; }
.export-body h6 { font-size: 13.5px; color: #555; }
.export-body strong { font-weight: 650; }
.export-body a { color: #3f63f0; text-decoration: underline; }
.export-body ul, .export-body ol { margin: 0.6em 0; padding-left: 1.5em; }
.export-body li { margin: 0.18em 0; }
.export-body li > p { margin: 0; }
.export-body blockquote {
  margin: 0.9em 0;
  padding: 2px 0 2px 14px;
  border-left: 3px solid #d8d8d2;
  color: #555550;
  break-inside: avoid;
}
.export-body blockquote p { margin: 0.25em 0; }
.export-body code {
  padding: 0.1em 0.35em;
  border: 1px solid #e6e6e1;
  border-radius: 4px;
  background: #f6f6f3;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 0.86em;
}
.export-body pre {
  margin: 1em 0;
  padding: 14px 16px;
  border: 1px solid #e6e6e1;
  border-radius: 8px;
  background: #f6f6f3;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
  break-inside: avoid;
}
.export-body pre code {
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12.5px;
  line-height: 1.65;
}
.export-body hr { margin: 1.7em 0; border: 0; border-top: 1px solid #e2e2dd; }
.export-body table {
  width: 100%;
  margin: 1em 0;
  border-collapse: collapse;
  border-spacing: 0;
  table-layout: fixed;
  break-inside: avoid;
}
.export-body th, .export-body td {
  padding: 7px 10px;
  border: 1px solid #dcdcd6;
  vertical-align: top;
  text-align: left;
}
.export-body th { background: #f6f6f2; font-weight: 600; }
.export-body th p, .export-body td p { margin: 0; }
.export-body ul[data-type="taskList"] { padding-left: 0.2em; list-style: none; }
.export-body ul[data-type="taskList"] > li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  list-style: none;
}
.export-body ul[data-type="taskList"] > li > label {
  flex: none;
  display: inline-flex;
  margin-top: 0.38em;
}
.export-body ul[data-type="taskList"] > li > div { flex: 1 1 auto; min-width: 0; }
.export-body ul[data-type="taskList"] > li > div > p { margin: 0.15em 0; }
.export-body input[type="checkbox"] { width: 13px; height: 13px; accent-color: #4f6ef7; }
.export-body details {
  margin: 0.9em 0;
  padding: 8px 12px;
  border: 1px solid #e4e4df;
  border-radius: 8px;
  break-inside: avoid;
}
.export-body summary {
  color: #232321;
  font-weight: 600;
  line-height: 1.5;
}
.export-body details > div { padding-top: 4px; }
.export-body details > div > :first-child { margin-top: 0.3em; }
.export-body [data-callout] {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin: 0.9em 0;
  padding: 12px 14px;
  border: 1px solid #e6e2d5;
  border-radius: 10px;
  background: #faf9f4;
  break-inside: avoid;
}
.export-body .note-callout-icon {
  flex: none;
  font-size: 18px;
  line-height: 1.55;
  user-select: none;
}
.export-body .note-callout-body { flex: 1 1 auto; min-width: 0; }
.export-body .note-callout-body > :first-child { margin-top: 0; }
.export-body .note-callout-body > :last-child { margin-bottom: 0; }
.export-body img {
  max-width: 100%;
  height: auto;
  margin: 0.6em auto;
  border-radius: 6px;
  display: block;
}
.export-embed {
  margin: 0.9em 0;
  padding: 10px 14px;
  border: 1px solid #e4e4df;
  border-radius: 8px;
  background: #f8f8f5;
  color: #444440;
  font-size: 13.5px;
  break-inside: avoid;
}
`
