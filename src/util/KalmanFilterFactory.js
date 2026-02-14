import KalmanFilter1D from './KalmanFilter1D.js';
import KalmanFilterQuaternion from './KalmanFilterQuaternion.js';

export function createKalmanFilterX(Q = 0.01, R = 0.001) {
  // X-axis: no gravity, default tuning
  return new KalmanFilter1D(0, 0, Q, R);
}

export function createKalmanFilterY(Q = 0.02, R = 0.001) {
  // Y-axis: higher Q for gravity uncertainty
  return new KalmanFilter1D(0, 0, Q, R);
}

export function createKalmanFilterZ(Q = 0.01, R = 0.001) {
  // Z-axis: same as X (no gravity)
  return new KalmanFilter1D(0, 0, Q, R);
}

export function createKalmanFilterVelX(Q = 0.05, R = 0.002) {
  // Velocity X: smooth velocity changes
  return new KalmanFilter1D(0, 0, Q, R);
}

export function createKalmanFilterVelY(Q = 0.1, R = 0.002) {
  // Velocity Y: higher Q for gravity/jump impulse variations
  return new KalmanFilter1D(0, 0, Q, R);
}

export function createKalmanFilterVelZ(Q = 0.05, R = 0.002) {
  // Velocity Z: same as X
  return new KalmanFilter1D(0, 0, Q, R);
}

export function createKalmanFilterRotation(Q = 0.1, R = 0.01) {
  // Rotation: smooth quaternion based on angular velocity
  // Q: trust the rotation model (constant angular velocity)
  // R: trust server snapshots
  return new KalmanFilterQuaternion([0, 0, 0, 1], [0, 0, 0], Q, R);
}
