/**
 * Vite plugin: Express API + Socket.io beágyazva a Vite dev szerverbe
 * Így az /api/* kérések közvetlenül a Vite szerveren belül kezeltek,
 * nincs szükség külön proxy-ra vagy portnyitásra.
 */
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, 'backend');

// Backend saját mongoose-át kell használni (backend/node_modules/mongoose)
// különben a route-ok és a plugin eltérő mongoose-példányt használnak
const backendMongoosePath = path.join(backendDir, 'node_modules/mongoose/index.js');

let mongooseConnected = false;
let socketIoServer = null;

export function apiPlugin() {
  return {
    name: 'vite-api-plugin',
    async configureServer(server) {
      // Backend mongoose-példány importja (ugyanaz, amit a route-ok is használnak)
      const mongoose = (await import(pathToFileURL(backendMongoosePath).href)).default;

      if (!mongooseConnected) {
        try {
          await mongoose.connect('mongodb://localhost:27017/szesztestverek');
          console.log('[API Plugin] MongoDB csatlakozva');
          mongooseConnected = true;
        } catch (err) {
          console.error('[API Plugin] MongoDB hiba:', err.message);
        }
      }

      // Backend route-ok dinamikus importja
      const authRoutes = (await import(pathToFileURL(path.join(backendDir, 'routes/auth.js')).href)).default;
      const productRoutes = (await import(pathToFileURL(path.join(backendDir, 'routes/products.js')).href)).default;
      const orderRoutes = (await import(pathToFileURL(path.join(backendDir, 'routes/orders.js')).href)).default;
      const adminRoutes = (await import(pathToFileURL(path.join(backendDir, 'routes/admin.js')).href)).default;
      const settingRoutes = (await import(pathToFileURL(path.join(backendDir, 'routes/settings.js')).href)).default;
      const reviewRoutes = (await import(pathToFileURL(path.join(backendDir, 'routes/reviews.js')).href)).default;

      // Express app létrehozása
      const app = express();
      app.use(cors({ origin: '*', credentials: false }));
      app.use(express.json());

      // Socket.io a Vite HTTP szerverhez csatolva
      if (server.httpServer && !socketIoServer) {
        socketIoServer = new Server(server.httpServer, {
          cors: { origin: '*', methods: ['GET', 'POST'] },
          path: '/socket.io',
        });

        socketIoServer.on('connection', (socket) => {
          socket.on('join_admin', () => socket.join('admins'));
          socket.on('join_customer', (orderId) => socket.join(`order_${orderId}`));
          socket.on('join_courier', (courierId) => socket.join(`courier_${courierId}`));
          socket.on('new_order', (order) => socketIoServer.to('admins').emit('new_order', order));
          socket.on('order_status_update', (data) => {
            socketIoServer.to(`order_${data.orderId}`).emit('order_status_update', data);
            socketIoServer.to('admins').emit('order_status_update', data);
          });
          socket.on('courier_location', (data) => {
            socketIoServer.to(`order_${data.orderId}`).emit('courier_location', data);
            socketIoServer.to('admins').emit('courier_location', data);
          });
        });

        console.log('[API Plugin] Socket.io inicializálva');
      }

      // io elérhetővé tétele a route-ok számára
      app.set('io', socketIoServer);

      // API útvonalak regisztrálása
      app.use('/api/auth', authRoutes);
      app.use('/api/products', productRoutes);
      app.use('/api/orders', orderRoutes);
      app.use('/api/admin', adminRoutes);
      app.use('/api/settings', settingRoutes);
      app.use('/api/reviews', reviewRoutes);

      // Express middleware hozzáadása Vite connect szerverhez — csak /api/* kérésekre,
      // egyébként átengedjük Vite statikus fájlkezelőjének
      server.middlewares.use((req, res, next) => {
        if (req.url.startsWith('/api') || req.url.startsWith('/socket.io')) {
          app(req, res, next);
        } else {
          next();
        }
      });

      console.log('[API Plugin] API route-ok aktívak: /api/*');
    },
  };
}

