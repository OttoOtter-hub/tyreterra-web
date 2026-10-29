import { ApiError } from './api';

// The API answers 409 when a listing's sizes sit on different rims; the seller
// may confirm that this is right, and the request is sent again with
// confirm_rim_mismatch. Returns null when the seller cancels.
export async function withRimConfirm<T>(send: (confirmRimMismatch: boolean) => Promise<T>): Promise<T | null> {
  try {
    return await send(false);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && /rim/i.test(e.message)) {
      if (!window.confirm(`${e.message}\n\nSave anyway?`)) return null;
      return send(true);
    }
    throw e;
  }
}
