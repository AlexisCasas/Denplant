/**
 * useNtsUnsavedChanges — "is there clinical text nobody has saved?", shared.
 *
 * The odontogram shell knows the answer: it owns the observations buffer, the
 * specification composer and the finding editor. The controls that can take
 * the shell away do **not** live inside it — the chart-format selector is a
 * sibling in the same card header, and a route change comes from outside
 * both. Neither can reach the shell's internals, and neither should: what
 * they need is one boolean.
 *
 * So the shell publishes, and whoever is about to change the context reads.
 * `useState` for the same reason `useOdontogramProfile` uses it — the two
 * components have to agree without one owning the other.
 *
 * **Two states, not one.** `dirty` is text a clinician typed and has not
 * saved; it can be discarded, because only the browser ever had it.
 * `writing` is a mutation already sent, or its refetch still running; that
 * cannot be discarded, because the server may already have it. They need
 * different answers, so they are different flags.
 *
 * Nothing is persisted. Buffers stay in memory and a confirmation is what
 * protects them — a copy in `localStorage` would be a second source of truth
 * for clinical text, which is exactly what this module refuses everywhere
 * else.
 */

export function useNtsUnsavedChanges() {
  /** Clinical text typed and not yet sent anywhere. Discardable. */
  const dirty = useState<boolean>('nts:unsaved:dirty', () => false)
  /** A mutation is in flight, or its refetch is. Not discardable. */
  const writing = useState<boolean>('nts:unsaved:writing', () => false)

  /**
   * Whether leaving right now would lose something, for any reason.
   *
   * Callers that only need "may I navigate?" should read this; callers that
   * have to *explain* why should read the two flags, because the honest
   * message differs.
   */
  const isBlocked = computed(() => dirty.value || writing.value)

  function publish(state: { dirty: boolean, writing: boolean }): void {
    dirty.value = state.dirty
    writing.value = state.writing
  }

  /**
   * Forget everything.
   *
   * Called when the shell unmounts: state shared through `useState` outlives
   * the component, and a stale `true` would block navigation on a screen that
   * no longer has anything to lose.
   */
  function reset(): void {
    dirty.value = false
    writing.value = false
  }

  return { dirty, writing, isBlocked, publish, reset }
}
