import type { Checkpoint } from "@landed/db";

export interface FileState {
  inode: number;
  size: number;
  mtimeMs: number;
}

export type ReadPlan =
  | { action: "skip" }
  /** `reset`: discard rows previously imported from this file, then read from 0. */
  | { action: "read"; from: number; reset: boolean };

/** Decides how much of a source file to (re-)read (PRD §21.3). */
export function planRead(
  prev: Checkpoint | undefined,
  file: FileState,
  parserVersion: string,
): ReadPlan {
  if (!prev) return { action: "read", from: 0, reset: false };
  const rewritten = prev.inode !== file.inode || file.size < prev.byteOffset;
  if (rewritten || prev.parserVersion !== parserVersion)
    return { action: "read", from: 0, reset: true };
  if (file.size === prev.byteOffset) return { action: "skip" };
  return { action: "read", from: prev.byteOffset, reset: false };
}
