/** Errores que devolvió el servidor al rechazar una importación (todo o nada). */
export function serverIssues(details: unknown): string[] {
  const errors = (details as { errors?: { id: string; message: string }[] } | null)?.errors;
  return Array.isArray(errors) ? errors.map((e) => `${e.id}: ${e.message}`) : [];
}
