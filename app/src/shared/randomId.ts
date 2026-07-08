export const createRandomId = (prefix?: string): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return prefix === undefined || prefix === "" ? id : `${prefix}-${id}`;
};
