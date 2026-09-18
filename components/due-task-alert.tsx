"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isDictationActive, onDictationStateChange } from "@/lib/dictation-activity";

type Props = {
  userId: string;
  onOpenJourney: () => void;
  onOpenCollections: () => void;
};

type DueTask = {
  id: number;
  title: string;
  description: string | null;
  due_at: string;
  kind: string;
};

const collectionKinds = new Set(["collection_call", "payment_promise"]);

export function DueTaskAlert({ userId, onOpenJourney, onOpenCollections }: Props) {
  const running = useRef(false);
  const deferredByDictation = useRef(false);

  const check = useCallback(async () => {
    if (running.current) return;
    if (isDictationActive()) {
      deferredByDictation.current = true;
      return;
    }
    running.current = true;
    try {
      const supabase = getSupabaseBrowserClient();
      const unseen: DueTask[] = [];
      const pageSize = 100;
      for (let offset = 0; unseen.length < 20; offset += pageSize) {
        const { data, error } = await supabase
          .from("financial_tasks")
          .select("id,title,description,due_at,kind")
          .eq("assigned_to", userId)
          .in("status", ["pending", "in_progress"])
          .lte("due_at", new Date().toISOString())
          .order("due_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) return;
        const page = (data ?? []) as DueTask[];
        unseen.push(...page.filter((task) => {
          const key = `lyvra:task-alert:${userId}:${task.id}:${task.due_at}`;
          return window.localStorage.getItem(key) !== "1";
        }));
        if (page.length < pageSize || offset > 5000) break;
      }
      unseen.splice(20);
      if (!unseen.length) return;

      // Alguns navegadores encerram o reconhecimento de voz quando uma região
      // de alerta aparece. Adie o aviso sem marcá-lo como visto.
      if (isDictationActive()) {
        deferredByDictation.current = true;
        return;
      }

      for (const task of unseen) {
        window.localStorage.setItem(`lyvra:task-alert:${userId}:${task.id}:${task.due_at}`, "1");
      }

      const first = unseen[0];
      const extra = unseen.length - 1;
      const collectionTask = collectionKinds.has(first.kind);
      toast.warning(extra > 0 ? `${unseen.length} tarefas pedem atenção agora` : first.title, {
        id: `lyvra-due-${first.id}`,
        description: extra > 0
          ? `${first.title}${first.description ? ` • ${first.description}` : ""} e mais ${extra}.`
          : first.description ?? (collectionTask ? "Esta cobrança chegou ao horário definido na régua." : "Esta tarefa chegou ao horário definido na Jornada financeira."),
        duration: Infinity,
        action: {
          label: collectionTask ? "Abrir cobrança" : "Abrir jornada",
          onClick: collectionTask ? onOpenCollections : onOpenJourney,
        },
      });
    } finally {
      running.current = false;
    }
  }, [onOpenCollections, onOpenJourney, userId]);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), 60_000);
    const onFocus = () => void check();
    const unsubscribeDictation = onDictationStateChange((active) => {
      if (!active && deferredByDictation.current) {
        deferredByDictation.current = false;
        void check();
      }
    });
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      unsubscribeDictation();
    };
  }, [check]);

  return null;
}
