/* Runtime configuration. This is the only file you edit to connect the backend.
   Both values below are safe to be public (the publishable key is designed for
   browsers; the real Graph secret lives only in Supabase). */
window.ARETE_CONFIG = {
    // Supabase Edge Function that emails the PDF to HR.
    SEND_ENDPOINT: "https://yanaxjuqqhvnrpqwlusb.supabase.co/functions/v1/send-to-hr",

    // Supabase publishable key (Project Settings -> API). Sent so Supabase routes
    // the request; NOT a secret.
    SEND_AUTH: "sb_publishable_zyZ25cWsSdFdyEub8WN2Cw_KHGr35ro",

    // Shown to the employee after a successful send.
    HR_LABEL: "Arete Care HR",
};
