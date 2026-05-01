"use client";

import { useEffect, useState } from "react";
import styles from "./drop-zone.module.css";

type Props = {
  onFiles: (files: File[]) => void;
};

export function ViewportDropZone({ onFiles }: Props) {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let counter = 0;

    function hasFiles(e: DragEvent) {
      return Array.from(e.dataTransfer?.types ?? []).includes("Files");
    }

    function onDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      counter += 1;
      setDragging(true);
    }
    function onDragOver(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
    }
    function onDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      counter -= 1;
      if (counter <= 0) {
        counter = 0;
        setDragging(false);
      }
    }
    function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      counter = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) onFiles(files);
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [onFiles]);

  return (
    <div
      className={`${styles.overlay} ${dragging ? styles.overlayActive : ""}`}
      aria-hidden
    >
      <div className={styles.hairline} />
      <div className={styles.hint}>Release to upload</div>
    </div>
  );
}
