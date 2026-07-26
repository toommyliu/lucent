const downloadBlob = (filename: string, blob: Blob): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = url;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const downloadJson = (filename: string, value: unknown): void => {
  downloadBlob(
    filename,
    new Blob([JSON.stringify(value, null, 2)], {
      type: "application/json",
    }),
  );
};

export const downloadText = (filename: string, value: string): void => {
  downloadBlob(filename, new Blob([value], { type: "text/plain" }));
};
