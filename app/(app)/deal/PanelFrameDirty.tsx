"use client";

import { useEffect } from "react";
import { useDealFrame } from "./PanelFrame";

/** Tells the panel frame whether its form has unsaved changes (so closing asks first). */
export function PanelFrameDirty({ dirty }: { dirty: boolean }) {
  const frame = useDealFrame();
  useEffect(() => frame.setDirty(dirty), [dirty, frame]);
  return null;
}
