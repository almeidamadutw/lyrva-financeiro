"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Props = {
  userId: string;
  onOpenJourney: () => void;
};

type DueTask = {
  id: number;
  title: string;
  description: string | null;
  due_at: string;
};

export function DueTaskAlert({ userId, onOpenJourney }: Props) {
  const running = useRef(false);

  const check = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("financial_tasks")
        .select("id,title,description,due_at")
        .eq("assigned_to", userId)
        .in("status", ["pending", "in_progress"])
        .lte("due_at", new Date().toISOString())
        .order("due_at", { ascending: true })
        .limit(20);

      if (error) return;
      const due = (data ?? []) as DueTask[];
      const unseen = due.filter((task) => {
        const key = `lyvra:task-alert:${userId}:${task.id}:${task.due_at}`;
        return window.localStorage.getItem(key) !== "1";
      });
      if (!unseen.length) return;

      for (const task of unseen) {
        window.localStorage.setItem(`lyvra:task-alert:${userId}:${task.id}:${task.due_at}`, "1");
      }

      const first = unseen[0];
      const extra = unseen.length - 1;
      toast.warning(extra > 0 ? `${unseen.length} tarefas pedem atenção agora` : first.title, {
        id: `lyvra-due-${first.id}`,
        description: extra > 0
          ? `${first.title}${first.description ? ` • ${first.description}` : ""} e mais ${extra}.`
          : first.description ?? "Esta tarefa chegou ao horário definido na Jornada financeira.",
        duration: Infinity,
        action: {
          label: "Abrir jornada",
          onClick: onOpenJourney,
        },
      });
    } finally {
      running.current = false;
    }
  }, [onOpenJourney, userId]);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), 60_000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [check]);

  return null;
}
