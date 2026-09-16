from pathlib import Path

# globals.css
p=Path('app/globals.css')
s=p.read_text()
s=s.replace('@media(min-width:768px){html:has(.app-density){font-size:80%}}', '''@media(min-width:768px){html:has(.app-density){font-size:clamp(13px,calc(9.7px + .25vw),16px)}}\n.lyvra-page{padding:clamp(1rem,1.2vw + .25rem,1.75rem)}\n.lyvra-page-inner{width:100%;max-width:1800px;margin-inline:auto;min-width:0;container-type:inline-size}\n.lyvra-split-dashboard,.lyvra-split-collections{display:grid;grid-template-columns:minmax(0,1fr);gap:1.25rem}\n.lyvra-split-dashboard>* , .lyvra-split-collections>*{min-width:0}\n@container (min-width:1420px){.lyvra-split-dashboard{grid-template-columns:minmax(0,1.55fr) minmax(300px,.7fr)}}\n@container (min-width:1580px){.lyvra-split-collections{grid-template-columns:minmax(0,1fr) minmax(320px,360px)}}''')
p.write_text(s)

# main app shell + dashboard split
p=Path('components/lyvra-app.tsx')
s=p.read_text()
s=s.replace('<main className="min-h-[calc(100svh-4.5rem)] bg-[#f7f8f4] p-4 md:p-7">\n          <div className="mx-auto max-w-[1500px]">', '<main className="lyvra-page min-h-[calc(100svh-4.5rem)] bg-[#f7f8f4]">\n          <div className="lyvra-page-inner">')
s=s.replace('<section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.7fr)]"><ObligationsTable', '<section className="lyvra-split-dashboard"><ObligationsTable')
p.write_text(s)

# collection split only when container can really support it
p=Path('components/collections-journey-real.tsx')
s=p.read_text()
s=s.replace('<section className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(310px,.55fr)]">', '<section className="lyvra-split-collections">')
s=s.replace('<div className="surface-card overflow-hidden rounded-[24px]">\n        <Tabs', '<div className="surface-card min-w-0 overflow-hidden rounded-[24px]">\n        <Tabs')
s=s.replace('<aside className="space-y-5">', '<aside className="min-w-0 space-y-5">')
p.write_text(s)
