from pathlib import Path

path = Path('components/collections-journey-real.tsx')
s = path.read_text(encoding='utf-8')

s = s.replace(
'''type SpeechRecognitionLike = {\n  lang: string;\n  continuous: boolean;\n  interimResults: boolean;\n  start: () => void;\n  stop: () => void;\n  onresult: ((event: SpeechRecognitionEventLike) => void) | null;\n  onend: (() => void) | null;\n  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;\n};\n\ntype SpeechRecognitionConstructor = new () => SpeechRecognitionLike;''',
'''type SpeechAvailability = "available" | "downloadable" | "downloading" | "unavailable";\ntype SpeechRecognitionOptionsLike = { langs: string[]; processLocally?: boolean; quality?: string };\n\ntype SpeechRecognitionLike = {\n  lang: string;\n  continuous: boolean;\n  interimResults: boolean;\n  processLocally?: boolean;\n  start: () => void;\n  stop: () => void;\n  onresult: ((event: SpeechRecognitionEventLike) => void) | null;\n  onend: (() => void) | null;\n  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;\n};\n\ntype SpeechRecognitionConstructor = {\n  new (): SpeechRecognitionLike;\n  available?: (options: SpeechRecognitionOptionsLike) => Promise<SpeechAvailability>;\n  install?: (options: SpeechRecognitionOptionsLike) => Promise<boolean>;\n};''',
1,
)

old = '''    const recognition = new Recognition();\n    recognition.lang = "pt-BR";\n    recognition.continuous = true;\n    recognition.interimResults = false;\n    recognition.onresult = (event) => {\n      const pieces: string[] = [];\n      for (let index = event.resultIndex; index < event.results.length; index += 1) {\n        if (event.results[index].isFinal) pieces.push(event.results[index][0].transcript.trim());\n      }\n      if (pieces.length) setNote((current) => `${current}${current.trim() ? " " : ""}${pieces.join(" ")}`);\n    };\n    recognition.onend = () => { recognitionRef.current = null; setListening(false); };'''

new = '''    const isOpera = /OPR\\//.test(navigator.userAgent);\n    let useLocalRecognition = false;\n\n    if (Recognition.available) {\n      try {\n        const availability = await Recognition.available({ langs: ["pt-BR"], processLocally: true });\n        if (availability === "available") {\n          useLocalRecognition = true;\n        } else if ((availability === "downloadable" || availability === "downloading") && Recognition.install) {\n          toast.info("Preparando o ditado em português", { description: "Na primeira vez o navegador pode baixar o pacote de voz." });\n          useLocalRecognition = await Recognition.install({ langs: ["pt-BR"], processLocally: true });\n        }\n      } catch {\n        useLocalRecognition = false;\n      }\n    }\n\n    if (isOpera && !useLocalRecognition && !Recognition.available) {\n      toast.info("O Opera não liberou o reconhecimento local", { description: "O microfone funciona, mas esta versão do Opera pode não entregar a transcrição. O LYVRA ainda tentará o reconhecimento disponível." });\n    }\n\n    const recognition = new Recognition();\n    recognition.lang = "pt-BR";\n    recognition.continuous = false;\n    recognition.interimResults = true;\n    if (useLocalRecognition && "processLocally" in recognition) recognition.processLocally = true;\n\n    const noteBeforeDictation = note.trim();\n    let receivedTranscript = false;\n    recognition.onresult = (event) => {\n      const pieces: string[] = [];\n      for (let index = 0; index < event.results.length; index += 1) {\n        const transcript = event.results[index][0]?.transcript?.trim();\n        if (transcript) pieces.push(transcript);\n      }\n      const spoken = pieces.join(" ").trim();\n      if (spoken) {\n        receivedTranscript = true;\n        setNote(`${noteBeforeDictation}${noteBeforeDictation ? " " : ""}${spoken}`);\n      }\n    };\n    recognition.onend = () => {\n      recognitionRef.current = null;\n      setListening(false);\n      if (!receivedTranscript && isOpera) {\n        toast.info("O Opera encerrou o áudio sem devolver texto", { description: "Toque novamente no microfone. Se o pacote local estiver disponível, o LYVRA passa a usá-lo automaticamente." });\n      }\n    };'''

if old not in s:
    raise SystemExit('bloco de reconhecimento atual não encontrado')
s = s.replace(old, new, 1)

s = s.replace(
'"language-not-supported":',
'"language-not-supported":',
1,
) if '"language-not-supported":' in s else s

needle = '        "network": "A transcrição por voz perdeu a conexão. Tente novamente.",\n'
if needle in s:
    s = s.replace(needle, needle + '        "language-not-supported": "O português ainda não está disponível para reconhecimento local neste navegador.",\n', 1)

path.write_text(s, encoding='utf-8')
