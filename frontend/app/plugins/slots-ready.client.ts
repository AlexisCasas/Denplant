/**
 * Raises the slot hydration barrier once the initial render has been
 * hydrated. Until then `resolveSlot()` returns [] so the first client
 * render matches the SSR HTML, which never sees client-only
 * registrations.
 *
 * The hook is `app:suspense:resolve`, NOT `app:mounted`: `vueApp.mount()`
 * returns (and `app:mounted` fires) before the root Suspense has
 * hydrated the layout and page, so flipping there would still leak the
 * registrations into the first hydrated render.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const ready = useSlotsReady()
  nuxtApp.hooks.hookOnce('app:suspense:resolve', async () => {
    await nextTick()
    ready.value = true
  })
})
