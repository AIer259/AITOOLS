export interface CodeLanguage {
  /** 写入代码块属性的语言标识，例如 python */
  id: string
  /** 界面与导出中显示的名称，例如 Python */
  label: string
  /** 搜索时额外匹配的短名或别名，例如 py */
  aliases: string[]
}

export const PLAIN_TEXT_ID = 'plaintext'

export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: PLAIN_TEXT_ID, label: 'Plain Text', aliases: ['text', 'plain', 'txt', '纯文本'] },
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'node', 'nodejs'] },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts'] },
  { id: 'jsx', label: 'JSX', aliases: ['react'] },
  { id: 'tsx', label: 'TSX', aliases: ['react-ts'] },
  { id: 'html', label: 'HTML', aliases: ['htm'] },
  { id: 'css', label: 'CSS', aliases: ['stylesheet'] },
  { id: 'scss', label: 'SCSS', aliases: ['sass'] },
  { id: 'less', label: 'Less', aliases: ['lessc'] },
  { id: 'json', label: 'JSON', aliases: ['jsonc'] },
  { id: 'yaml', label: 'YAML', aliases: ['yml'] },
  { id: 'xml', label: 'XML', aliases: ['svg'] },
  { id: 'markdown', label: 'Markdown', aliases: ['md'] },
  { id: 'python', label: 'Python', aliases: ['py'] },
  { id: 'java', label: 'Java', aliases: ['jdk'] },
  { id: 'kotlin', label: 'Kotlin', aliases: ['kt', 'kts'] },
  { id: 'swift', label: 'Swift', aliases: [] },
  { id: 'c', label: 'C', aliases: [] },
  { id: 'cpp', label: 'C++', aliases: ['c++', 'cc', 'cxx', 'hpp'] },
  { id: 'csharp', label: 'C#', aliases: ['cs', 'dotnet'] },
  { id: 'go', label: 'Go', aliases: ['golang'] },
  { id: 'rust', label: 'Rust', aliases: ['rs'] },
  { id: 'ruby', label: 'Ruby', aliases: ['rb'] },
  { id: 'php', label: 'PHP', aliases: [] },
  { id: 'sql', label: 'SQL', aliases: ['mysql', 'postgresql', 'postgres', 'sqlite'] },
  { id: 'shell', label: 'Shell', aliases: ['bash', 'sh', 'zsh', 'shellscript'] },
  { id: 'powershell', label: 'PowerShell', aliases: ['ps1', 'pwsh'] },
  { id: 'dockerfile', label: 'Dockerfile', aliases: ['docker'] },
  { id: 'nginx', label: 'Nginx', aliases: ['conf'] },
  { id: 'vue', label: 'Vue', aliases: ['vuejs'] },
  { id: 'svelte', label: 'Svelte', aliases: ['sveltejs'] },
  { id: 'graphql', label: 'GraphQL', aliases: ['gql'] },
  { id: 'lua', label: 'Lua', aliases: [] },
  { id: 'r', label: 'R', aliases: ['rlang'] },
  { id: 'matlab', label: 'MATLAB', aliases: ['octave'] },
  { id: 'objectivec', label: 'Objective-C', aliases: ['objc', 'objective-c'] },
  { id: 'dart', label: 'Dart', aliases: ['flutter'] },
  { id: 'scala', label: 'Scala', aliases: ['sbt'] },
  { id: 'perl', label: 'Perl', aliases: ['pl'] },
  { id: 'haskell', label: 'Haskell', aliases: ['hs'] },
  { id: 'elixir', label: 'Elixir', aliases: ['ex'] },
  { id: 'erlang', label: 'Erlang', aliases: ['erl'] },
  { id: 'clojure', label: 'Clojure', aliases: ['clj'] },
  { id: 'groovy', label: 'Groovy', aliases: ['gradle'] },
  { id: 'julia', label: 'Julia', aliases: ['jl'] },
  { id: 'makefile', label: 'Makefile', aliases: ['make'] },
  { id: 'ini', label: 'INI', aliases: ['toml', 'conf', 'config'] },
  { id: 'diff', label: 'Diff', aliases: ['patch'] },
]

const LANGUAGE_BY_ID = new Map(CODE_LANGUAGES.map((language) => [language.id, language]))
const LANGUAGE_BY_ALIAS = new Map<string, CodeLanguage>()

for (const language of CODE_LANGUAGES) {
  for (const alias of language.aliases) {
    const key = alias.toLowerCase()
    if (!LANGUAGE_BY_ALIAS.has(key)) LANGUAGE_BY_ALIAS.set(key, language)
  }
}

const PLAIN_TEXT = LANGUAGE_BY_ID.get(PLAIN_TEXT_ID) as CodeLanguage

/** 空值、plaintext 都按纯文本处理，避免 Markdown 围栏写出语言别名 */
export function normalizeCodeLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const language = value.trim().toLowerCase()
  if (!language || language === PLAIN_TEXT_ID) return null
  return language
}

export function getCodeLanguage(value: unknown): CodeLanguage {
  const id = normalizeCodeLanguage(value)
  if (!id) return PLAIN_TEXT
  return LANGUAGE_BY_ID.get(id) ?? LANGUAGE_BY_ALIAS.get(id) ?? { id, label: id, aliases: [] }
}

export function codeLanguageLabel(value: unknown): string {
  return getCodeLanguage(value).label
}

export function filterCodeLanguages(query: string): CodeLanguage[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return CODE_LANGUAGES

  return CODE_LANGUAGES.map((language, index) => {
    const values = [language.id, language.label, ...language.aliases]
    let score = 0

    for (const value of values) {
      const candidate = value.toLowerCase()
      if (candidate === normalized) score = Math.max(score, 100)
      else if (candidate.startsWith(normalized)) score = Math.max(score, 80)
      else if (candidate.includes(normalized)) score = Math.max(score, 60)
    }

    return { language, score, index }
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.language)
}
