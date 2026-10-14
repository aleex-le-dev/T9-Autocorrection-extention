// Test de l'URL Google OAuth officielle
const params = new URLSearchParams({
  client_id: '407408718192.apps.googleusercontent.com',
  redirect_uri: 'https://aistudio.google.com',
  response_type: 'token',
  scope: 'email profile',
  prompt: 'select_account'
});

const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
console.log("Google Auth URL:", url);
