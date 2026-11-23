function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length < 16) throw new Error(`${name} must be set to a random string of at least 16 characters`);
  return v;
}

export const env = {
  get nidSecret() { return required('NID_HASH_SECRET'); },
  get cardSecret() { return required('CARD_TOKEN_SECRET'); },
  get isProd() { return process.env.NODE_ENV === 'production'; },
};
