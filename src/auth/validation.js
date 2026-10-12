const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/i;

export function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function usernameError(value) {
  const username = normalizeUsername(value);
  if (!USERNAME.test(username)) {
    return 'Enter a username of 3 to 32 letters, numbers, dots, underscores, or hyphens.';
  }
  return null;
}

export function passwordError(password, username) {
  const value = String(password ?? '');
  if (value.length < 12 || value.length > 128) {
    return 'Use a password of 12 to 128 characters.';
  }
  if (value.trim().length === 0) {
    return 'Use a password of 12 to 128 characters.';
  }
  if (username && value.toLowerCase() === normalizeUsername(username)) {
    return 'Choose a password that is not the username.';
  }
  return null;
}
