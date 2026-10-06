import { createContext, type ReactNode, useContext, useState } from "react";

/**
 * Plain-language copy in English and Turkish. Every screen speaks in sentences a non-specialist
 * can follow ("not committed yet"), and keeps the precise term (`uncommitted`) for tooltips only.
 * `tr` is typed as `typeof en`, so a missing translation is a type error.
 */

export type Lang = "en" | "tr";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const en = {
  common: {
    loading: "Loading…",
    error: "Something went wrong.",
    copied: "Copied",
    and: " and ",
    files: (n: number) => plural(n, "file", "files"),
    lines: (n: number) => plural(n, "line", "lines"),
    commits: (n: number) => plural(n, "commit", "commits"),
    sessions: (n: number) => plural(n, "session", "sessions"),
    days: (n: number) => plural(n, "day", "days"),
    noRepo: "outside any project",
    unknownRepo: "A project",
    more: (n: number) => `${n} more`,
    whatIsThis: "What is this?",
  },
  nav: {
    home: "Overview",
    todo: "To do",
    projects: "Projects",
    history: "History",
    settings: "Settings",
    footer: "Runs only on this computer. Your prompts and code never leave it.",
  },
  header: {
    live: "Live",
    connected: "Connected",
    offline: "Offline",
    liveHelp: "Watching your agents; changes show up within seconds.",
    connectedHelp: "Showing the last scan. Run `landed start` for live updates.",
    offlineHelp: "Can't reach the Landed server on this computer.",
    lastScan: (ago: string) => `Last checked ${ago}`,
    notScanned: "Not checked yet",
    scan: "Check now",
    scanning: "Checking…",
    scanHelp: "Read new agent history and compare it with git again",
    scanFailed: "Check failed:",
    language: "Language",
  },
  welcome: {
    title: "Let's see what your agents did",
    body: "Landed reads the history Claude Code and Codex already keep on this computer, then checks your git projects to see which of their work was saved and which was left behind. Nothing is uploaded and nothing is changed.",
    button: "Check my agents' work",
    scanning: "Reading history… this can take a minute",
  },
  outcome: {
    landed: "Committed",
    landedHelp: "In a commit. Safe.",
    waiting: "Not committed yet",
    waitingHelp: "Still in the files, but never committed.",
    partial: "Partly committed",
    partialHelp: "Only some of it reached a commit.",
    lost: "Lost",
    lostHelp: "Neither in a commit nor in the files any more.",
    superseded: "Replaced later",
    supersededHelp: "The same session rewrote it.",
    unknown: "Can't tell",
    unknownHelp: "Not in a git project, or nothing to compare.",
  },
  status: {
    completed: "Finished",
    active: "Working",
    running: "Working now",
    failed: "Failed",
    interrupted: "Stopped midway",
    "awaiting-user": "Waiting for you",
    dangling: "Unfinished",
    landed: "Committed",
    abandoned: "Left behind",
    unknown: "—",
  } as Record<string, string>,
  home: {
    title: (days: number) =>
      days === 7
        ? "What did your agents do this week?"
        : `What did your agents do in ${days} days?`,
    sentence: (agents: string, repos: number, files: number) =>
      files === 0
        ? `${agents || "Your agents"} worked in ${plural(repos, "project", "projects")} but changed no files.`
        : `${agents || "Your agents"} changed ${plural(files, "file", "files")} in ${plural(repos, "project", "projects")}.`,
    verdict: (open: number) =>
      open === 0
        ? "Everything they started is settled."
        : `Most of it is safe, but ${plural(open, "thing needs", "things need")} a decision from you.`,
    noActivity: "Your agents haven't worked in this period.",
    tileFiles: (n: number) => plural(n, "file", "files"),
    waitingTitle: "Waiting for you",
    seeAll: (n: number) => `${n} more`,
    noneWaiting: "Nothing is waiting for you. Everything your agents started is settled.",
    runningTitle: "Working right now",
    running: (agent: string, repo: string, files: number, ago: string) =>
      `${agent} is working in ${repo}. ${files ? `Changed ${plural(files, "file", "files")}, last` : "Last"} activity ${ago}.`,
    recentTitle: "Recent work",
    recentEmpty: "No work with file changes yet.",
    glossaryTitle: "What do these words mean?",
    glossary: [
      ["Commit", "A saved snapshot of your project in git. Work in a commit is safe."],
      [
        "Not committed yet",
        "The agent's changes are in your files, but no commit contains them. If the files are reset or the computer is lost, the work is gone.",
      ],
      [
        "Lost",
        "The agent wrote it, but it is neither in a commit nor in your files any more — usually undone or overwritten.",
      ],
      [
        "Branch / main branch",
        "A branch is a separate line of work. Work only counts as finished once it is merged into the main branch (usually main).",
      ],
      ["Session", "One conversation with an agent, from start to finish."],
    ] as [string, string][],
  },
  loop: {
    since: (date: string) => `since ${date}`,
    why: "Why it matters",
    todo: "What to do",
    copyCommand: "Copy command",
    commandHelp: "A read-only git command that shows exactly what is waiting",
    handoff: "Hand to an agent",
    handoffHelp: "Copies a summary of this work you can paste into any agent to continue",
    resolve: "Done",
    resolveHelp: "You took care of it",
    dismiss: "Not needed",
    dismissPrompt: "Why isn't this needed? (optional, helps improve Landed)",
    reopen: "Reopen",
    showFiles: (n: number) => `Show ${plural(n, "file", "files")}`,
    hideFiles: "Hide files",
    openWork: "Open this work",
    dismissed: (reason: string) => `Marked not needed${reason ? `: ${reason}` : ""}`,
    "uncommitted-output": {
      title: (repo: string, files: number, days: number) =>
        `${repo}: ${plural(files, "file", "files")} not committed for ${plural(days, "day", "days")}`,
      why: "Your agent's changes are sitting in the files but were never committed. If the files are reset or the computer changes, they are gone.",
      todo: "Open the project and look at the changes. Commit what's useful, undo the rest.",
    },
    "unmerged-agent-branch": {
      title: (repo: string, branch: string | undefined, days: number) =>
        `${repo}: ${branch ? `branch ${branch}` : "a branch"} not merged for ${plural(days, "day", "days")}`,
      why: (main: string) =>
        `The agent's work was committed on this branch but never merged into the main branch (${main}). For anyone working on ${main}, it doesn't exist.`,
      todo: "Review the branch. If it's ready, merge it; if not, delete the branch.",
    },
    "lost-work": {
      title: (repo: string, lines: number) =>
        `${repo}: ${plural(lines, "line", "lines")} your agent wrote are lost`,
      why: "These lines are neither in a commit nor in your files. They were probably undone or overwritten.",
      todo: "If you still need this work, hand it to an agent to redo it — or mark it not needed.",
    },
    "failed-unresolved": {
      title: (repo: string, interrupted: boolean) =>
        `${repo}: a session ${interrupted ? "was stopped midway" : "failed"} and nobody picked it up`,
      why: "The session ended before finishing, and no later session finished the same work.",
      todo: "To continue, hand it to an agent. If it doesn't matter any more, mark it not needed.",
    },
    "awaiting-user": {
      title: (repo: string) => `${repo}: an agent is waiting for your answer`,
      why: "The agent asked a question or asked for permission, and has been waiting since.",
      todo: "Go back to that session and answer it.",
    },
    "orphan-worktree": {
      title: (repo: string) => `${repo}: a leftover agent workspace`,
      why: "An agent created a separate working copy that still exists.",
      todo: "Check it and delete it if it's no longer needed.",
    },
  },
  todoPage: {
    title: "To do",
    subtitle:
      "Work your agents left unfinished. Items close by themselves once the work is committed or merged.",
    tabs: { open: "Waiting", dismissed: "Not needed", resolved: "Done" } as Record<string, string>,
    empty: {
      open: "Nothing is waiting for you.",
      dismissed: "Nothing marked as not needed.",
      resolved: "Nothing done yet.",
    } as Record<string, string>,
  },
  projects: {
    title: "Projects",
    subtitle: "How much of your agents' work was committed, project by project.",
    periods: [
      ["7 days", 7],
      ["30 days", 30],
      ["90 days", 90],
      ["All time", 0],
    ] as [string, number][],
    allTitle: "All projects",
    summary: (files: number, landed: string) =>
      `${plural(files, "file", "files")} changed by agents — ${landed} committed.`,
    repoLine: (files: number, landed: string) =>
      `${plural(files, "file", "files")} · ${landed} committed`,
    stillThere: (pct: string) => `${pct} of committed work is still in the project today.`,
    speed: (hours: string) => `Work usually reaches a commit within ${hours} hours.`,
    lowConfidence: "Numbers here are approximate",
    lowConfidenceHelp:
      "In this project, agent edits often look like lines that were already in git, so matching is less reliable.",
    missing: "project folder no longer exists",
    compareTitle: "Agents compared in this project",
    compareCaveat:
      "Differences may come from how you used each agent (which tasks, how big), not from the agent itself.",
    committedShare: (pct: string, lo: string, hi: string, n: number) =>
      `${pct} committed (likely between ${lo} and ${hi}, ${plural(n, "file", "files")})`,
    byKind: "By kind of work",
    noData: "No agent changes in this period.",
    notJudgedTitle: "Changes Landed couldn't check",
    notJudged: (n: number) => plural(n, "change", "changes"),
    reasons: {
      "outside-repo": "Made outside any git project",
      "no-signal": "Only blank lines or deletions",
      "repo-missing": "The project folder was deleted",
      gitignored: "Files git ignores (e.g. .env, build output)",
      "git-error": "Git couldn't be read",
    } as Record<string, string>,
    limits:
      "Landed only sees edits made through the agents' edit tools. Changes made by shell commands or formatters are invisible to it.",
  },
  history: {
    title: "History",
    subtitle: "Everything your agents worked on.",
    tabs: { work: "Work", sessions: "Sessions" } as Record<string, string>,
    workHelp: "Related sessions grouped into one piece of work, even across days and agents.",
    sessionsHelp: "Every conversation with an agent.",
    showEmpty: "Also show ones that changed no files",
    cols: {
      work: "Work",
      agents: "Agents",
      sessions: "Sessions",
      result: "Result",
      status: "Status",
      last: "Last active",
      session: "Session",
      agent: "Agent",
      started: "Started",
      files: "Files",
    },
    untitled: "Untitled session",
    subagents: (n: number) => plural(n, "helper agent", "helper agents"),
    failures: (n: number) => plural(n, "failed command", "failed commands"),
    range: (a: number, b: number, total: number) => `${a}–${b} of ${total}`,
    newer: "← Newer",
    older: "Older →",
    empty: "Nothing here yet.",
    allAgents: "All agents",
    anyStatus: "Any status",
  },
  thread: {
    crumb: "History",
    sessionsTitle: "Sessions in this work",
    filesTitle: "Files and what happened to them",
    noFiles: "No file changes.",
    handoff: "Hand to an agent",
    linkWhy: {
      continuation: "helper of",
      "same-branch": "same branch as",
      "file-overlap": "changed the same files as",
      "line-overlap": "changed lines written by",
    } as Record<string, string>,
    earlier: "an earlier session",
  },
  session: {
    filesTitle: "Files it changed",
    noFiles: "This session changed no files.",
    edits: (n: number, added: number, removed: number) =>
      `${plural(n, "edit", "edits")} · +${added} −${removed}`,
    inCommit: (sha: string, subject?: string) =>
      `in commit ${sha}${subject ? ` “${subject}”` : ""}`,
    timelineTitle: "What it did",
    noEvents: "Nothing recorded.",
    usageTitle: "Usage (tokens)",
    usage: { input: "Input", cached: "Cached", output: "Output" },
    coverage: (c: string): string =>
      c === "complete" ? "complete" : c === "partial" ? "some missing" : "not reported",
    insightsTitle: "Worth knowing",
    subagentsTitle: (n: number) => `Helper agents · ${n}`,
    helper: (agent: string) => `${agent} helper`,
    failed: "failed",
    events: {
      "prompt.submitted": "You wrote a message",
      "turn.completed": "Agent replied",
      "edit.applied": "Changed a file",
      "command.completed": "Ran a command",
      "command.failed": "A command failed",
      "tool.completed": "Used a tool",
      "tool.failed": "A tool failed",
      "subagent.started": "Started a helper agent",
      "subagent.ended": "Helper agent finished",
      "approval.resolved": "Permission denied",
      "approval.requested": "Asked for permission",
      "agent.interrupted": "Stopped",
      "session.started": "Session started",
      "session.ended": "Session ended",
      "session.awaiting-user": "Asked you a question",
      error: "Error",
    } as Record<string, string>,
  },
  settings: {
    title: "Settings",
    languageTitle: "Language",
    languageBody: "Choose the language of this dashboard.",
    sourcesTitle: "Where Landed reads from",
    found: "found",
    missing: "missing",
    sourcesNote: (n: number) =>
      `${plural(n, "session", "sessions")} read. Landed only reads these folders and your git projects; it never changes agent settings, their history, or your projects.`,
    lastScan: (when: string, secs: string) => `Last check ${when} · ${secs}s`,
    liveTitle: "Live updates",
    liveOn: "on",
    liveOff: "off",
    liveBodyOn: "Landed is watching your agents and updates this page within seconds.",
    liveBodyOff: "This page shows the last check. For live updates, run:",
    liveStart: "keep checking in the background",
    liveAutostart: "start it when you log in",
    livePlugin: "also notice when Claude Code waits for your permission",
    liveHooks: "the same for Codex (your own hooks are kept)",
    notifications:
      "Desktop notifications when an agent waits for you or two agents edit the same file",
    turnOn: "Turn on",
    turnOff: "Turn off",
    excludeTitle: "Folders that never go on your to-do list",
    excludeBody:
      "Agents often write reports and plans for you to read, not to commit. Files in these folders never show up as unfinished work. One folder per line, relative to the project root.",
    excludeSave: "Save",
    saving: "Saving…",
    excludeSaved: (n: number) => `Saved. ${plural(n, "item", "items")} closed.`,
    mcpTitle: "Let agents ask Landed (MCP)",
    mcpBody:
      "Your agents can ask Landed before they start: is someone else editing these files, what happened here recently, what was tried before and failed. It only reads, and it never shares prompts or code.",
    mcpClaude: "connect Claude Code",
    mcpCodex: "connect Codex",
    mcpUndo: "To undo:",
    privacyTitle: "Privacy",
    privacy: [
      ["Your prompts", "never stored"],
      ["Your code", "never stored (only unreadable fingerprints, to recognize lines)"],
      ["Command output", "never stored"],
      ["Commands", "first line only, with passwords and keys hidden"],
      ["Internet", "nothing is sent anywhere"],
    ] as [string, string][],
    privacyNote:
      "Hiding passwords and keys is a safety net, not a guarantee: commands and file names can still be sensitive.",
    summaryTitle: "Written summary (optional)",
    summaryBody: (cmd: string) =>
      `When on, the overview can ask your installed agent (${cmd}) to write a short summary. It only receives counts, titles and commit messages — never prompts or code — and that agent's company receives them.`,
    reportTitle: "Shareable report",
    reportLast: (d: number) => `Last ${d} days`,
    reportNames: "Include project names",
    reportOpen: "Open report →",
    reportNote:
      "A single page with totals only. By default it has no project names, file names, code or prompts.",
    diagTitle: "Technical details",
    dataFolder: "Data folder",
    database: "Database",
    badLines: "Lines it couldn't read",
    repo: "Project",
    defaultBranch: "Main branch",
    selfCheck: "Self-check A / B",
    selfCheckHelp:
      "How often agent edits match earlier commits / unrelated files (lower is better)",
    confidence: "Reliability",
    reliable: "normal",
    approximate: "approximate",
  },
  toast: { open: "Open →", dismiss: "Dismiss" },
};

const tr: typeof en = {
  common: {
    loading: "Yükleniyor…",
    error: "Bir şeyler ters gitti.",
    copied: "Kopyalandı",
    and: " ve ",
    files: (n) => `${n} dosya`,
    lines: (n) => `${n} satır`,
    commits: (n) => `${n} commit`,
    sessions: (n) => `${n} oturum`,
    days: (n) => `${n} gün`,
    noRepo: "bir proje dışında",
    unknownRepo: "Bir proje",
    more: (n) => `${n} tane daha`,
    whatIsThis: "Bu ne demek?",
  },
  nav: {
    home: "Özet",
    todo: "Yapılacaklar",
    projects: "Projeler",
    history: "Geçmiş",
    settings: "Ayarlar",
    footer: "Sadece bu bilgisayarda çalışır. Prompt'ların ve kodun hiçbir yere gitmez.",
  },
  header: {
    live: "Canlı",
    connected: "Bağlı",
    offline: "Bağlantı yok",
    liveHelp: "Ajanların izleniyor; değişiklikler birkaç saniyede görünür.",
    connectedHelp: "Son kontrol gösteriliyor. Canlı güncelleme için `landed start` çalıştır.",
    offlineHelp: "Bu bilgisayardaki Landed sunucusuna ulaşılamıyor.",
    lastScan: (ago) => `Son kontrol ${ago}`,
    notScanned: "Henüz kontrol edilmedi",
    scan: "Şimdi kontrol et",
    scanning: "Kontrol ediliyor…",
    scanHelp: "Yeni ajan geçmişini oku ve git ile yeniden karşılaştır",
    scanFailed: "Kontrol başarısız:",
    language: "Dil",
  },
  welcome: {
    title: "Ajanlarının ne yaptığına bakalım",
    body: "Landed, Claude Code ve Codex'in bu bilgisayarda zaten tuttuğu geçmişi okur, sonra git projelerine bakarak ajanların yaptığı işin hangisinin kaydedildiğini, hangisinin yarım kaldığını gösterir. Hiçbir şey yüklenmez, hiçbir şey değiştirilmez.",
    button: "Ajanlarımın işine bak",
    scanning: "Geçmiş okunuyor… bir dakika sürebilir",
  },
  outcome: {
    landed: "Kaydedildi",
    landedHelp: "Bir commit'e girdi, güvende.",
    waiting: "Kaydedilmeyi bekliyor",
    waitingHelp: "Dosyalarda duruyor ama hiç commit'lenmedi.",
    partial: "Kısmen kaydedildi",
    partialHelp: "Sadece bir kısmı commit'e girdi.",
    lost: "Kayboldu",
    lostHelp: "Ne bir commit'te ne de artık dosyalarda.",
    superseded: "Sonradan değiştirildi",
    supersededHelp: "Aynı oturum sonradan yeniden yazdı.",
    unknown: "Anlaşılamadı",
    unknownHelp: "Bir git projesinde değil ya da karşılaştıracak bir şey yok.",
  },
  status: {
    completed: "Bitti",
    active: "Çalışıyor",
    running: "Şu an çalışıyor",
    failed: "Hata verdi",
    interrupted: "Yarıda kesildi",
    "awaiting-user": "Seni bekliyor",
    dangling: "Yarım kaldı",
    landed: "Kaydedildi",
    abandoned: "Bırakıldı",
    unknown: "—",
  },
  home: {
    title: (days) =>
      days === 7 ? "Ajanların bu hafta ne yaptı?" : `Ajanların son ${days} günde ne yaptı?`,
    sentence: (agents, repos, files) =>
      files === 0
        ? `${agents || "Ajanların"} ${repos} projede çalıştı ama hiçbir dosyayı değiştirmedi.`
        : `${agents || "Ajanların"} ${repos} projede ${files} dosyayı değiştirdi.`,
    verdict: (open) =>
      open === 0
        ? "Başlattıkları her şey tamamlanmış."
        : `Çoğu güvende, ama ${open} iş senden bir karar bekliyor.`,
    noActivity: "Ajanların bu dönemde çalışmadı.",
    tileFiles: (n) => `${n} dosya`,
    waitingTitle: "Senden bekleyenler",
    seeAll: (n) => `${n} iş daha`,
    noneWaiting: "Senden bekleyen bir iş yok. Ajanların başladığı her şey tamamlanmış.",
    runningTitle: "Şu an çalışan",
    running: (agent, repo, files, ago) =>
      `${agent}, ${repo} projesinde çalışıyor. ${files ? `${files} dosyayı değiştirdi, son hareket` : "Son hareket"} ${ago}.`,
    recentTitle: "Son işler",
    recentEmpty: "Henüz dosya değiştiren bir iş yok.",
    glossaryTitle: "Bu kelimeler ne demek?",
    glossary: [
      ["Commit", "Projenin git'e kaydedilmiş bir anlık hali. Commit'e giren iş güvendedir."],
      [
        "Kaydedilmeyi bekliyor",
        "Ajanın değişiklikleri dosyalarında ama hiçbir commit'te yok. Dosyalar geri alınırsa ya da bilgisayar giderse iş kaybolur.",
      ],
      [
        "Kayboldu",
        "Ajan yazmış ama artık ne bir commit'te ne de dosyalarda — genelde geri alınmış ya da üzerine yazılmış.",
      ],
      [
        "Dal / ana dal",
        "Dal (branch), işin ayrı bir kolu. Bir iş ancak ana dala (genelde main) birleştirildiğinde bitmiş sayılır.",
      ],
      ["Oturum", "Bir ajanla baştan sona yapılan tek bir konuşma."],
    ],
  },
  loop: {
    since: (date) => `${date} tarihinden beri`,
    why: "Neden önemli",
    todo: "Ne yapmalı",
    copyCommand: "Komutu kopyala",
    commandHelp: "Bekleyen işi tam olarak gösteren, hiçbir şeyi değiştirmeyen bir git komutu",
    handoff: "Bir ajana devret",
    handoffHelp: "Bu işin özetini kopyalar; herhangi bir ajana yapıştırıp devam ettirebilirsin",
    resolve: "Hallettim",
    resolveHelp: "Bununla ilgilendin",
    dismiss: "Gerek yok",
    dismissPrompt: "Neden gerek yok? (isteğe bağlı, Landed'ı geliştirmeye yardım eder)",
    reopen: "Geri aç",
    showFiles: (n) => `${n} dosyayı göster`,
    hideFiles: "Dosyaları gizle",
    openWork: "Bu işi aç",
    dismissed: (reason) => `Gerek yok olarak işaretlendi${reason ? `: ${reason}` : ""}`,
    "uncommitted-output": {
      title: (repo, files, days) => `${repo}: ${files} dosya ${days} gündür kaydedilmedi`,
      why: "Ajanın yaptığı değişiklikler dosyalarda duruyor ama hiç commit'lenmedi. Dosyalar geri alınırsa ya da bilgisayar değişirse kaybolurlar.",
      todo: "Projeyi aç ve değişikliklere bak. İşe yarayanları commit et, gerisini geri al.",
    },
    "unmerged-agent-branch": {
      title: (repo, branch, days) =>
        `${repo}: ${branch ? `${branch} dalı` : "bir dal"} ${days} gündür ana dala eklenmedi`,
      why: (main) =>
        `Ajanın işi bu dalda commit'lendi ama ana dala (${main}) hiç birleştirilmedi. ${main} üzerinde çalışan biri için bu iş yok.`,
      todo: "Dalı gözden geçir. Hazırsa ana dala birleştir, değilse dalı sil.",
    },
    "lost-work": {
      title: (repo, lines) => `${repo}: ajanın yazdığı ${lines} satır kayboldu`,
      why: "Bu satırlar ne bir commit'te ne de dosyalarda. Muhtemelen geri alındı ya da üzerine yazıldı.",
      todo: "Bu işe hâlâ ihtiyacın varsa bir ajana devret ve yeniden yaptır; yoksa gerek yok olarak işaretle.",
    },
    "failed-unresolved": {
      title: (repo, interrupted) =>
        `${repo}: bir oturum ${interrupted ? "yarıda kesildi" : "hata verdi"} ve kimse devam etmedi`,
      why: "Oturum bitmeden durdu ve aynı işi sonradan tamamlayan başka bir oturum olmadı.",
      todo: "Devam etmek istiyorsan bir ajana devret. Artık önemli değilse gerek yok olarak işaretle.",
    },
    "awaiting-user": {
      title: (repo) => `${repo}: bir ajan senden cevap bekliyor`,
      why: "Ajan bir soru sordu ya da izin istedi ve o zamandan beri bekliyor.",
      todo: "O oturuma dön ve cevap ver.",
    },
    "orphan-worktree": {
      title: (repo) => `${repo}: ajandan kalma bir çalışma kopyası`,
      why: "Bir ajan ayrı bir çalışma kopyası oluşturdu ve hâlâ duruyor.",
      todo: "Kontrol et, gerekmiyorsa sil.",
    },
  },
  todoPage: {
    title: "Yapılacaklar",
    subtitle:
      "Ajanlarının yarım bıraktığı işler. İş commit'lenince ya da birleştirilince kendiliğinden kapanırlar.",
    tabs: { open: "Bekleyenler", dismissed: "Gerek yok", resolved: "Hallettiklerim" },
    empty: {
      open: "Senden bekleyen bir iş yok.",
      dismissed: "Gerek yok olarak işaretlenen bir şey yok.",
      resolved: "Henüz hallettiğin bir şey yok.",
    },
  },
  projects: {
    title: "Projeler",
    subtitle: "Her projede ajanların yaptığı işin ne kadarı commit'lendi.",
    periods: [
      ["7 gün", 7],
      ["30 gün", 30],
      ["90 gün", 90],
      ["Tümü", 0],
    ],
    allTitle: "Tüm projeler",
    summary: (files, landed) =>
      `Ajanlar ${files} dosyayı değiştirdi; commit'lenen oran: ${landed}.`,
    repoLine: (files, landed) => `${files} dosya · commit'lenen: ${landed}`,
    stillThere: (pct) => `Commit'lenen işten bugün hâlâ projede duran: ${pct}.`,
    speed: (hours) => `İş genelde ${hours} saat içinde commit'e giriyor.`,
    lowConfidence: "Buradaki sayılar yaklaşık",
    lowConfidenceHelp:
      "Bu projede ajanın değişiklikleri sık sık git'te zaten olan satırlara benziyor, bu yüzden eşleştirme daha az güvenilir.",
    missing: "proje klasörü artık yok",
    compareTitle: "Bu projede ajanların karşılaştırması",
    compareCaveat:
      "Farklar ajanın kendisinden değil, her ajanı nasıl kullandığından (hangi işler, ne büyüklükte) kaynaklanıyor olabilir.",
    committedShare: (pct, lo, hi, n) =>
      `commit'lenen: ${pct} (büyük ihtimalle ${lo} ile ${hi} arası, ${n} dosya)`,
    byKind: "İşin türüne göre",
    noData: "Bu dönemde ajan değişikliği yok.",
    notJudgedTitle: "Landed'ın kontrol edemediği değişiklikler",
    notJudged: (n) => `${n} değişiklik`,
    reasons: {
      "outside-repo": "Bir git projesi dışında yapıldı",
      "no-signal": "Sadece boş satır ya da silme",
      "repo-missing": "Proje klasörü silinmiş",
      gitignored: "Git'in yok saydığı dosyalar (ör. .env, derleme çıktısı)",
      "git-error": "Git okunamadı",
    },
    limits:
      "Landed sadece ajanların düzenleme araçlarıyla yaptığı değişiklikleri görür. Kabuk komutları ya da biçimlendiricilerle yapılan değişiklikler görünmez.",
  },
  history: {
    title: "Geçmiş",
    subtitle: "Ajanlarının üzerinde çalıştığı her şey.",
    tabs: { work: "İşler", sessions: "Oturumlar" },
    workHelp:
      "Birbiriyle ilgili oturumlar, günler ve ajanlar arasında bile olsa tek bir iş olarak toplanır.",
    sessionsHelp: "Bir ajanla yapılan her konuşma.",
    showEmpty: "Dosya değiştirmeyenleri de göster",
    cols: {
      work: "İş",
      agents: "Ajanlar",
      sessions: "Oturum",
      result: "Sonuç",
      status: "Durum",
      last: "Son hareket",
      session: "Oturum",
      agent: "Ajan",
      started: "Başladı",
      files: "Dosya",
    },
    untitled: "Başlıksız oturum",
    subagents: (n) => `${n} yardımcı ajan`,
    failures: (n) => `${n} başarısız komut`,
    range: (a, b, total) => `${total} oturumdan ${a}–${b}`,
    newer: "← Daha yeni",
    older: "Daha eski →",
    empty: "Burada henüz bir şey yok.",
    allAgents: "Tüm ajanlar",
    anyStatus: "Her durum",
  },
  thread: {
    crumb: "Geçmiş",
    sessionsTitle: "Bu işteki oturumlar",
    filesTitle: "Dosyalar ve onlara ne oldu",
    noFiles: "Dosya değişikliği yok.",
    handoff: "Bir ajana devret",
    linkWhy: {
      continuation: "yardımcısı:",
      "same-branch": "aynı dalda:",
      "file-overlap": "aynı dosyaları değiştirdi:",
      "line-overlap": "şunun yazdığı satırları değiştirdi:",
    },
    earlier: "önceki bir oturum",
  },
  session: {
    filesTitle: "Değiştirdiği dosyalar",
    noFiles: "Bu oturum hiçbir dosyayı değiştirmedi.",
    edits: (n, added, removed) => `${n} düzenleme · +${added} −${removed}`,
    inCommit: (sha, subject) => `${sha} commit'inde${subject ? ` “${subject}”` : ""}`,
    timelineTitle: "Ne yaptı",
    noEvents: "Kayıt yok.",
    usageTitle: "Kullanım (token)",
    usage: { input: "Giriş", cached: "Önbellek", output: "Çıkış" },
    coverage: (c) =>
      c === "complete" ? "tam" : c === "partial" ? "bir kısmı eksik" : "bildirilmedi",
    insightsTitle: "Bilmekte fayda var",
    subagentsTitle: (n) => `Yardımcı ajanlar · ${n}`,
    helper: (agent) => `${agent} yardımcısı`,
    failed: "başarısız",
    events: {
      "prompt.submitted": "Bir mesaj yazdın",
      "turn.completed": "Ajan cevap verdi",
      "edit.applied": "Bir dosyayı değiştirdi",
      "command.completed": "Bir komut çalıştırdı",
      "command.failed": "Bir komut başarısız oldu",
      "tool.completed": "Bir araç kullandı",
      "tool.failed": "Bir araç başarısız oldu",
      "subagent.started": "Yardımcı bir ajan başlattı",
      "subagent.ended": "Yardımcı ajan bitirdi",
      "approval.resolved": "İzin reddedildi",
      "approval.requested": "İzin istedi",
      "agent.interrupted": "Durduruldu",
      "session.started": "Oturum başladı",
      "session.ended": "Oturum bitti",
      "session.awaiting-user": "Sana bir soru sordu",
      error: "Hata",
    },
  },
  settings: {
    title: "Ayarlar",
    languageTitle: "Dil",
    languageBody: "Bu panelin dilini seç.",
    sourcesTitle: "Landed nereden okuyor",
    found: "bulundu",
    missing: "yok",
    sourcesNote: (n) =>
      `${n} oturum okundu. Landed sadece bu klasörleri ve git projelerini okur; ajan ayarlarını, geçmişlerini ya da projelerini asla değiştirmez.`,
    lastScan: (when, secs) => `Son kontrol ${when} · ${secs} sn`,
    liveTitle: "Canlı güncelleme",
    liveOn: "açık",
    liveOff: "kapalı",
    liveBodyOn: "Landed ajanlarını izliyor ve bu sayfayı birkaç saniyede güncelliyor.",
    liveBodyOff: "Bu sayfa son kontrolü gösteriyor. Canlı güncelleme için şunu çalıştır:",
    liveStart: "arka planda kontrol etmeye devam et",
    liveAutostart: "bilgisayar açılınca başlat",
    livePlugin: "Claude Code senden izin beklediğinde de fark et",
    liveHooks: "aynısı Codex için (kendi hook'ların korunur)",
    notifications:
      "Bir ajan seni beklediğinde ya da iki ajan aynı dosyayı düzenlediğinde masaüstü bildirimi",
    turnOn: "Aç",
    turnOff: "Kapat",
    excludeTitle: "Yapılacaklara hiç düşmeyen klasörler",
    excludeBody:
      "Ajanlar çoğu zaman commit için değil, senin okuman için rapor ve plan yazar. Bu klasörlerdeki dosyalar asla yarım iş olarak görünmez. Her satıra bir klasör, proje köküne göre.",
    excludeSave: "Kaydet",
    saving: "Kaydediliyor…",
    excludeSaved: (n) => `Kaydedildi. ${n} iş kapandı.`,
    mcpTitle: "Ajanlar Landed'a sorabilsin (MCP)",
    mcpBody:
      "Ajanların, işe başlamadan önce Landed'a şunları sorabilir: bu dosyaları başka biri düzenliyor mu, burada son zamanlarda ne oldu, daha önce ne denendi ve tutmadı. Sadece okur; prompt ya da kod asla paylaşmaz.",
    mcpClaude: "Claude Code'a bağla",
    mcpCodex: "Codex'e bağla",
    mcpUndo: "Geri almak için:",
    privacyTitle: "Gizlilik",
    privacy: [
      ["Prompt'ların", "asla saklanmaz"],
      ["Kodun", "asla saklanmaz (satırları tanımak için sadece okunamaz parmak izleri)"],
      ["Komut çıktıları", "asla saklanmaz"],
      ["Komutlar", "sadece ilk satır, şifre ve anahtarlar gizlenerek"],
      ["İnternet", "hiçbir yere bir şey gönderilmez"],
    ],
    privacyNote:
      "Şifre ve anahtarların gizlenmesi bir güvenlik ağıdır, garanti değildir: komutlar ve dosya adları yine de hassas olabilir.",
    summaryTitle: "Yazılı özet (isteğe bağlı)",
    summaryBody: (cmd) =>
      `Açıkken özet sayfası, kurulu ajanından (${cmd}) kısa bir özet yazmasını isteyebilir. Ajan sadece sayıları, başlıkları ve commit mesajlarını alır — prompt ya da kod asla — ve bunlar o ajanın şirketine gider.`,
    reportTitle: "Paylaşılabilir rapor",
    reportLast: (d) => `Son ${d} gün`,
    reportNames: "Proje adlarını ekle",
    reportOpen: "Raporu aç →",
    reportNote:
      "Sadece toplamları içeren tek bir sayfa. Varsayılan olarak proje adı, dosya adı, kod ya da prompt içermez.",
    diagTitle: "Teknik ayrıntılar",
    dataFolder: "Veri klasörü",
    database: "Veritabanı",
    badLines: "Okunamayan satırlar",
    repo: "Proje",
    defaultBranch: "Ana dal",
    selfCheck: "Öz kontrol A / B",
    selfCheckHelp:
      "Ajan değişikliklerinin ne sıklıkla eski commit'lere / ilgisiz dosyalara benzediği (düşük olması iyi)",
    confidence: "Güvenilirlik",
    reliable: "normal",
    approximate: "yaklaşık",
  },
  toast: { open: "Aç →", dismiss: "Kapat" },
};

export type Dict = typeof en;
const DICTS: Record<Lang, Dict> = { en, tr };
const KEY = "landed.lang";

/** Saved choice, else the browser's language (Turkish browsers get Turkish), else English. */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "tr") return saved;
  } catch {}
  return navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

interface I18n {
  lang: Lang;
  t: Dict;
  setLang: (l: Lang) => void;
}

const Ctx = createContext<I18n>({ lang: "en", t: en, setLang: () => {} });
export const useI18n = () => useContext(Ctx);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const setLang = (l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem(KEY, l);
    } catch {}
  };
  return <Ctx.Provider value={{ lang, t: DICTS[lang], setLang }}>{children}</Ctx.Provider>;
}
