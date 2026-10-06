import React, { useEffect, useState } from "react";
import { db } from "./firebase";
import { collection, addDoc } from "firebase/firestore";

function App() {
  const [status, setStatus] = useState("Connecting to Firebase...");

  useEffect(() => {
    const testConnection = async () => {
      try {
        await addDoc(collection(db, "system_check"), {
          restaurant: "Siranchowk Khaja Ghar",
          status: "Firebase Connected Successfully!",
          timestamp: new Date(),
        });
        setStatus("Connected! Test data sent to Firestore successfully.");
      } catch (error) {
        console.error("Firebase Error:", error);
        setStatus("Connection error: " + error.message);
      }
    };

    testConnection();
  }, []);

  return (
    <div style={{ textAlign: "center", marginTop: "50px", fontFamily: "Arial, sans-serif" }}>
      <h1>Siranchowk Khaja Ghar</h1>
      <p>{status}</p>
    </div>
  );
}

export default App;