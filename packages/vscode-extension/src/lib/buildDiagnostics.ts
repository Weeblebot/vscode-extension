export interface ParsedBuildDiagnostic {
  path: string;
  line: number;
  column: number;
  message: string;
}

export function parseBuildDiagnostic(message: string): ParsedBuildDiagnostic | undefined {
  const match = message.match(
    /^\s*(?:✘\s*)?(?:\[(?:ERROR|WARNING)\]\s*)?(.+\.(?:[cm]?[jt]sx?|json|toml|ya?ml)):(\d+):(\d+):\s*(.+)\s*$/i,
  );
  if (!match) return undefined;
  return {
    path: match[1].replaceAll('\\', '/'),
    line: Math.max(0, Number(match[2]) - 1),
    column: Math.max(0, Number(match[3]) - 1),
    message: match[4],
  };
}

export function parseBuildDiagnostics(message: string): ParsedBuildDiagnostic[] {
  return message
    .split(/\r?\n/)
    .map(parseBuildDiagnostic)
    .filter((diagnostic): diagnostic is ParsedBuildDiagnostic => diagnostic !== undefined);
}
