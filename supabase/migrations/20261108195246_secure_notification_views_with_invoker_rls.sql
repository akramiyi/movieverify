ALTER VIEW public.user_notification_endpoints
SET (security_invoker = true);

ALTER VIEW public.notification_tokens
SET (security_invoker = true);
