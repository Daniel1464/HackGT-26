import { Redirect } from 'expo-router';

// The auth session consumes the URL; this route also handles a cold app launch.
export default function OAuthReturn() {
  return <Redirect href="/" />;
}
