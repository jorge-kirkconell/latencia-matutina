// Firebase — configuración compartida (dashboard + pwa)
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyDXocP7qKgJahnsxtZtbgOqdlOqc3GZi3g',
  authDomain:        'latencia-matutina.firebaseapp.com',
  databaseURL:       'https://latencia-matutina-default-rtdb.firebaseio.com',
  projectId:         'latencia-matutina',
  storageBucket:     'latencia-matutina.firebasestorage.app',
  messagingSenderId: '1005287855342',
  appId:             '1:1005287855342:web:25f26ec3ce59cb2c5c8fff',
};
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.database();
