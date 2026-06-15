// X-Idempotency-Key must be a UUID (the backend parses it as one). RN/Hermes has no built-in
// uuid, so generate a v4 here (fine for a POC; use a real uuid lib in production).
export function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
