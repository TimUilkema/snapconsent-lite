"use client";

import { useEffect, useState } from "react";

import type { ProjectMatchingProgress } from "@/lib/matching/project-matching-progress";

type ProjectMatchingProgressProps = {
  projectId: string;
  initialProgress: ProjectMatchingProgress;
};

export function ProjectMatchingProgress({ projectId, initialProgress }: ProjectMatchingProgressProps) {
  const [progress, setProgress] = useState<ProjectMatchingProgress>(initialProgress);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setProgress(initialProgress);
  }, [initialProgress]);

  useEffect(() => {
    if (!progress.isMatchingInProgress) {
      return;
    }

    let cancelled = false;
    const intervalId = window.setInterval(async () => {
      try {
        setIsRefreshing(true);
        const response = await fetch(`/api/projects/${projectId}/matching-progress`, {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as ProjectMatchingProgress | null;
        if (!response.ok || !payload || cancelled) {
          return;
        }

        setProgress(payload);
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [projectId, progress.isMatchingInProgress]);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Matching progress</h2>
          <p className="mt-1 text-xs text-zinc-600">
            {progress.processedImages} / {progress.totalImages} images processed
          </p>
          {progress.hasDegradedMatchingState ? (
            <p className="mt-1 text-xs text-amber-700">
              Matching needs attention. Automatic retries are active or a continuation is stalled.
            </p>
          ) : null}
        </div>
        <span
          className={`rounded-md px-2 py-1 text-xs font-medium ${
            progress.hasDegradedMatchingState
              ? "bg-amber-100 text-amber-800"
              : progress.isMatchingInProgress
                ? "bg-emerald-100 text-emerald-800"
                : "bg-zinc-100 text-zinc-700"
          }`}
        >
          {progress.hasDegradedMatchingState
            ? (progress.isMatchingInProgress ? "Matching degraded" : "Matching stalled")
            : (progress.isMatchingInProgress ? "Matching in progress" : "Matching idle")}
        </span>
      </div>

      <div className="mt-3 h-3 overflow-hidden rounded-md bg-zinc-200">
        <div
          className="h-full bg-zinc-900 transition-[width] duration-200"
          style={{ width: `${progress.progressPercent}%` }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-600">
        <span>{progress.progressPercent}% complete</span>
        {isRefreshing && progress.isMatchingInProgress ? <span>Updating...</span> : null}
      </div>
    </section>
  );
}
