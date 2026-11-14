export const initialState = () => ({ status: "idle", snapshot: null, error: null });
export async function loadProvider(state, fetchSnapshot, changed) {
  if (state.status === "loading") return;
  state.status = "loading";
  state.error = null;
  changed();
  try {
    state.snapshot = await fetchSnapshot();
    state.status = "ready";
  } catch (error) {
    state.status = "error";
    state.error = String(error?.message ?? error);
  }
  changed();
}
