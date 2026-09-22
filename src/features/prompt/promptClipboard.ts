export async function copyWholePrompt(
  value: string,
  write: (value: string) => Promise<void>,
) {
  if (!value) return;
  await write(value);
}
