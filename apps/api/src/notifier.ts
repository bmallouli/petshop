// Small in-repo notifier. Emits adoption notifications; console logging is
// sufficient for now. Kept as its own module so the delivery mechanism can be
// swapped later without touching the route.
export type NotificationEvent = 'pet-adopted'

export function sendNotification(event: NotificationEvent, payload: Record<string, unknown>): void {
  console.log(`[notify] ${event} ${JSON.stringify(payload)}`)
}
