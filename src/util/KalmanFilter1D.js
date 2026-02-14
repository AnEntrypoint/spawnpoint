class KalmanFilter1D {
  constructor(initialPos = 0, initialVel = 0, Q = 0.01, R = 0.001) {
    this.x = initialPos;
    this.v = initialVel;
    this.P00 = 1;
    this.P01 = 0;
    this.P10 = 0;
    this.P11 = 1;
    this.Q = Q;
    this.R = R;
  }

  predict(dt) {
    this.x += this.v * dt;
    const P00 = this.P00, P01 = this.P01, P10 = this.P10, P11 = this.P11;
    this.P00 = P00 + 2 * P01 * dt + P11 * dt * dt + this.Q;
    this.P01 = P01 + P11 * dt;
    this.P10 = P10 + P11 * dt;
    this.P11 = P11 + this.Q;
  }

  update(measurement) {
    const y = measurement - this.x;
    const S = this.P00 + this.R;
    const K0 = this.P00 / S;
    const K1 = this.P10 / S;
    this.x += K0 * y;
    this.v += K1 * y;
    this.P00 = (1 - K0) * this.P00;
    this.P01 = (1 - K0) * this.P01;
    this.P10 = (1 - K0) * this.P10;
    this.P11 = (1 - K0) * this.P11;
  }

  getState() {
    return { position: this.x, velocity: this.v };
  }

  reset(pos = 0, vel = 0) {
    this.x = pos;
    this.v = vel;
    this.P00 = 1;
    this.P01 = 0;
    this.P10 = 0;
    this.P11 = 1;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KalmanFilter1D;
}
