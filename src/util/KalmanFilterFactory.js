import KalmanFilter1D from './KalmanFilter1D.js';
import KalmanFilterQuaternion from './KalmanFilterQuaternion.js';

export function createKalmanFilterX(Q = 0.01, R = 0.001) {
  return new KalmanFilter1D(0, 0, Q, R);
}

export function createKalmanFilterY(Q = 0.02, R = 0.001) {
  return new KalmanFilter1D(0, 0, Q, R);
}

export function createKalmanFilterZ(Q = 0.01, R = 0.001) {
  return new KalmanFilter1D(0, 0, Q, R);
}

export function createKalmanFilterVelX(Q = 0.05, R = 0.002) {
  return new KalmanFilter1D(0, 0, Q, R);
}

export function createKalmanFilterVelY(Q = 0.1, R = 0.002) {
  return new KalmanFilter1D(0, 0, Q, R);
}

export function createKalmanFilterVelZ(Q = 0.05, R = 0.002) {
  return new KalmanFilter1D(0, 0, Q, R);
}

export function createKalmanFilterRotation(Q = 0.1, R = 0.01) {
  return new KalmanFilterQuaternion([0, 0, 0, 1], [0, 0, 0], Q, R);
}
