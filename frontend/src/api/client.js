import axios from "axios";
import { fetchAuthSession } from "aws-amplify/auth";

const client = axios.create({
  baseURL: process.env.REACT_APP_API_URL,
  headers: {
    "Content-Type": "application/json"
  }
});

client.interceptors.request.use(
  async (config) => {
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString();
      if (idToken) {
        config.headers.Authorization = `Bearer ${idToken}`;
      }
    } catch {
      // unauthenticated request — let it through
    }
    return config;
  },
  (error) => Promise.reject(error)
);

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.location = "/login";
    }
    return Promise.reject(error);
  }
);

export default client;
