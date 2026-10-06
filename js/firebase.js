import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAtMCvjCOM_fQHAJzzeaFsUiwQ0Ms6wvns",
  authDomain: "plasma-bounty-474104-m6.firebaseapp.com",
  databaseURL: "https://plasma-bounty-474104-m6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "plasma-bounty-474104-m6",
  storageBucket: "plasma-bounty-474104-m6.firebasestorage.app",
  messagingSenderId: "229985321157",
  appId: "1:229985321157:web:7bcb63b2c3bc062fa870ac"
};

const app = initializeApp(firebaseConfig);

export const db = getDatabase(app);
export const auth = getAuth(app);