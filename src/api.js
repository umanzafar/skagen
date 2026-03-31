const API_URL = "https://script.google.com/macros/s/AKfycbyCcP9gmcSEWodkDvFhC92ljBCTU5v-tf_flTIroo10UWUox_WISbDv4S-YfYV0grAp/exec";

export const api = {
  get: async (params) => {
    try {
      const res = await fetch(`${API_URL}?${new URLSearchParams(params)}`);
      const text = await res.text();
      return JSON.parse(text);
    } catch (err) {
      console.error("GET Error:", err);
      return [];
    }
  },
  post: async (data) => {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(data),
        redirect: "follow"
      });
      const text = await res.text();
      return JSON.parse(text);
    } catch (err) {
      console.error("POST Error:", err);
      return { error: err.toString() };
    }
  },
  uploadPhoto: async (employeeId, file) => {
    return new Promise((resolve, reject) => {
      if (file.size > 1024 * 1024) {
        reject(new Error("Photo 1MB se choti honi chahiye!"));
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = await api.post({
            action: "uploadPhoto",
            employee_id: employeeId,
            photo_base64: reader.result
          });
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
};