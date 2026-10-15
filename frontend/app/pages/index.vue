<script setup lang="ts">
import { resolveDefaultLanding } from '~/utils/defaultLanding'

const { active, ensureLoaded } = useModules()
const { permissions } = usePermissions()

// The modules response is also awaited by the default layout during SSR.
// Calling it here is idempotent and ensures direct requests to `/` use the
// same availability data before selecting a destination.
await ensureLoaded()

await navigateTo(resolveDefaultLanding({
  activeModules: active.value,
  permissions: permissions.value
}), { replace: true })
</script>
