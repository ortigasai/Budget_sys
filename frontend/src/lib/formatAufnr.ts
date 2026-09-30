// Display only - the IO code stays the full 12-digit zero-padded AUFNR
// everywhere it's matched or sent to the API; this just drops the padding's
// leading "0000" for a shorter, more scannable code.
export function formatAufnr(code: string): string {
  return code.startsWith("0000") ? code.slice(4) : code;
}
