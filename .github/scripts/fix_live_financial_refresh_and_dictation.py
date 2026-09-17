from pathlib import Path

# 1) App principal: atualização silenciosa e card de NFs emitidas do mês real.
app = Path('components/lyvra-app.tsx')
s = app.read_text(encoding='utf-8')

s = s.replace(
    '  issuedAmount?: number;\n};',
    '  issuedAmount?: number;\n  issuedAt?: string | null;\n};',
    1,
)

s = s.replace(
    '  const loadFinancialData = useCallback(async () => {\n    const supabase = getSupabaseBrowserClient();\n    setLoadingPatients(true);',
    '  const loadFinancialData = useCallback(async (silent = false) => {\n    const supabase = getSupabaseBrowserClient();\n    if (!silent) setLoadingPatients(true);',
    1,
)

s = s.replace(
    '    } finally {\n      setLoadingPatients(false);\n    }\n  }, []);',
    '    } finally {\n      if (!silent) setLoadingPatients(false);\n    }\n  }, []);',
    1,
)

s = s.replace(
    '          issuedAmount: Number(row.issued_amount ?? 0),\n        };',
    '          issuedAmount: Number(row.issued_amount ?? 0),\n          issuedAt: row.invoice_issued_at ?? null,\n        };',
    1,
)

marker = '  }, [loadFinancialData, loadProfile]);\n\n  const unitFilter = <UnitSelect value={unit} onChange={setUnit} />;'
insert = '''  }, [loadFinancialData, loadProfile]);\n\n  useEffect(() => {\n    if (!currentUser || currentUser.operationalArea === "support") return;\n    const refresh = () => { void loadFinancialData(true).catch(() => undefined); };\n    const interval = window.setInterval(refresh, 60_000);\n    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };\n    document.addEventListener("visibilitychange", onVisibility);\n    window.addEventListener("focus", refresh);\n    return () => {\n      window.clearInterval(interval);\n      document.removeEventListener("visibilitychange", onVisibility);\n      window.removeEventListener("focus", refresh);\n    };\n  }, [currentUser, loadFinancialData]);\n\n  const unitFilter = <UnitSelect value={unit} onChange={setUnit} />;'''
if marker not in s:
    raise SystemExit('app refresh marker not found')
s = s.replace(marker, insert, 1)

old = '  const issued = allFiltered.filter((item) => item.rawStatus === "issued");'
new = '''  const todayKey = saoPauloDate();\n  const currentMonthKey = todayKey.slice(0, 7);\n  const issued = allFiltered.filter((item) => item.rawStatus === "issued" && item.issuedAt && saoPauloDate(new Date(item.issuedAt)) <= todayKey && saoPauloDate(new Date(item.issuedAt)).slice(0, 7) === currentMonthKey);'''
if old not in s:
    raise SystemExit('dashboard issued marker not found')
s = s.replace(old, new, 1)
s = s.replace('label="Notas emitidas"', 'label="Emitidas neste mês"', 1)
app.write_text(s, encoding='utf-8')

# 2) Régua: ditado com pedido explícito de permissão + atualização silenciosa.
collections = Path('components/collections-journey-real.tsx')
c = collections.read_text(encoding='utf-8')

c = c.replace(
    'type SpeechRecognitionLike = {\n',
    'type SpeechRecognitionErrorEventLike = { error?: string; message?: string };\n\ntype SpeechRecognitionLike = {\n',
    1,
)
c = c.replace(
    '  onerror: (() => void) | null;\n};',
    '  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;\n};',
    1,
)

c = c.replace(
    '  const load = useCallback(async () => {\n    setLoading(true);',
    '  const load = useCallback(async (silent = false) => {\n    if (!silent) setLoading(true);',
    1,
)
c = c.replace(
    '    } finally {\n      setLoading(false);\n    }\n  }, []);',
    '    } finally {\n      if (!silent) setLoading(false);\n    }\n  }, []);',
    1,
)

load_effect = '  useEffect(() => { void load(); }, [load]);\n'
load_effect_new = '''  useEffect(() => { void load(); }, [load]);\n  useEffect(() => {\n    const refresh = () => { void load(true); };\n    const interval = window.setInterval(refresh, 60_000);\n    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };\n    document.addEventListener("visibilitychange", onVisibility);\n    window.addEventListener("focus", refresh);\n    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("focus", refresh); };\n  }, [load]);\n'''
if load_effect not in c:
    raise SystemExit('collection load effect not found')
c = c.replace(load_effect, load_effect_new, 1)

start = c.index('  const stopListening = () =>')
end = c.index('\n\n  const register = async () =>', start)
new_voice = '''  const stopListening = () => {\n    try { recognitionRef.current?.stop(); } catch { /* reconhecimento já encerrado */ }\n    recognitionRef.current = null;\n    setListening(false);\n  };\n\n  const toggleListening = async () => {\n    if (listening) { stopListening(); return; }\n    if (!window.isSecureContext) {\n      toast.error("O microfone precisa de uma conexão segura", { description: "Abra o LYVRA pelo endereço HTTPS oficial." });\n      return;\n    }\n\n    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;\n    if (!Recognition) {\n      toast.info("Este navegador não oferece transcrição por voz", { description: "No Chrome ou Edge o botão de ditado funciona diretamente. Você também pode usar o ditado do Windows com Win + H dentro do campo." });\n      return;\n    }\n\n    try {\n      if (navigator.mediaDevices?.getUserMedia) {\n        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });\n        stream.getTracks().forEach((track) => track.stop());\n      }\n    } catch {\n      toast.error("Permissão do microfone bloqueada", { description: "Libere o microfone para este site nas permissões do navegador e tente novamente." });\n      return;\n    }\n\n    const recognition = new Recognition();\n    recognition.lang = "pt-BR";\n    recognition.continuous = true;\n    recognition.interimResults = false;\n    recognition.onresult = (event) => {\n      const pieces: string[] = [];\n      for (let index = event.resultIndex; index < event.results.length; index += 1) {\n        if (event.results[index].isFinal) pieces.push(event.results[index][0].transcript.trim());\n      }\n      if (pieces.length) setNote((current) => `${current}${current.trim() ? " " : ""}${pieces.join(" ")}`);\n    };\n    recognition.onend = () => { recognitionRef.current = null; setListening(false); };\n    recognition.onerror = (event) => {\n      recognitionRef.current = null;\n      setListening(false);\n      const code = event?.error ?? "unknown";\n      const descriptions: Record<string, string> = {\n        "not-allowed": "O navegador bloqueou o microfone. Libere a permissão do site e tente novamente.",\n        "service-not-allowed": "O serviço de transcrição foi bloqueado pelo navegador. Tente Chrome ou Edge.",\n        "audio-capture": "Nenhum microfone disponível foi encontrado neste computador.",\n        "no-speech": "Não ouvi fala. Toque no microfone e fale novamente.",\n        "network": "A transcrição por voz perdeu a conexão. Tente novamente.",\n      };\n      toast.error("Não consegui transcrever o áudio", { description: descriptions[code] ?? "Confira o microfone e a permissão do navegador e tente novamente." });\n    };\n\n    try {\n      recognitionRef.current = recognition;\n      recognition.start();\n      setListening(true);\n    } catch {\n      recognitionRef.current = null;\n      setListening(false);\n      toast.error("O ditado não pôde ser iniciado", { description: "Feche qualquer gravação de voz aberta e tente novamente." });\n    }\n  };'''
c = c[:start] + new_voice + c[end:]
collections.write_text(c, encoding='utf-8')

# 3) Jornada financeira: atualização silenciosa automática.
journey = Path('components/financial-journey.tsx')
j = journey.read_text(encoding='utf-8')
j = j.replace(
    '  const load = useCallback(async () => {\n    setLoading(true);',
    '  const load = useCallback(async (silent = false) => {\n    if (!silent) setLoading(true);',
    1,
)
j = j.replace(
    '    } finally {\n      setLoading(false);\n    }\n  }, []);',
    '    } finally {\n      if (!silent) setLoading(false);\n    }\n  }, []);',
    1,
)
old_effect = '''  useEffect(() => {\n    void load();\n  }, [load]);\n'''
new_effect = '''  useEffect(() => {\n    void load();\n  }, [load]);\n\n  useEffect(() => {\n    const refresh = () => { void load(true); };\n    const interval = window.setInterval(refresh, 60_000);\n    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };\n    document.addEventListener("visibilitychange", onVisibility);\n    window.addEventListener("focus", refresh);\n    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("focus", refresh); };\n  }, [load]);\n'''
if old_effect not in j:
    raise SystemExit('journey effect not found')
j = j.replace(old_effect, new_effect, 1)
journey.write_text(j, encoding='utf-8')

# 4) Lembretes: atualização automática sem piscar a tela.
reminders = Path('components/payment-reminder-review.tsx')
r = reminders.read_text(encoding='utf-8')
r = r.replace('const load=useCallback(async()=>{setLoading(true);', 'const load=useCallback(async(silent=false)=>{if(!silent)setLoading(true);', 1)
r = r.replace('finally{setLoading(false)}},[date,unit]);', 'finally{if(!silent)setLoading(false)}},[date,unit]);', 1)
r = r.replace(
    ' useEffect(()=>{void load()},[load]); const selected=',
    ' useEffect(()=>{void load()},[load]); useEffect(()=>{const refresh=()=>{void load(true)};const interval=window.setInterval(refresh,60_000);const onVisibility=()=>{if(document.visibilityState==="visible")refresh()};document.addEventListener("visibilitychange",onVisibility);window.addEventListener("focus",refresh);return()=>{window.clearInterval(interval);document.removeEventListener("visibilitychange",onVisibility);window.removeEventListener("focus",refresh)}},[load]); const selected=',
    1,
)
reminders.write_text(r, encoding='utf-8')
