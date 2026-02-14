class KalmanFilterQuaternion {
  constructor(initialQ = [0, 0, 0, 1], initialAngVel = [0, 0, 0], Q = 0.1, R = 0.01) {
    this.q = [...initialQ];
    this.angularVel = [...initialAngVel];
    this.Q = Q;
    this.R = R;
  }

  predict(dt) {
    if (dt <= 0) return;
    const [wx, wy, wz] = this.angularVel;
    const halfDt = dt * 0.5;
    const w = Math.sqrt(wx * wx + wy * wy + wz * wz);

    let deltaQ;
    if (w > 1e-8) {
      const angle = w * halfDt;
      const sinAngle = Math.sin(angle);
      const cosAngle = Math.cos(angle);
      const scale = sinAngle / w;
      deltaQ = [scale * wx, scale * wy, scale * wz, cosAngle];
    } else {
      deltaQ = [wx * halfDt, wy * halfDt, wz * halfDt, 1.0];
    }

    this.q = this._quatMultiply(this.q, deltaQ);
    this._normalizeQuat(this.q);
  }

  update(measuredQuaternion) {
    const measured = [...measuredQuaternion];
    const dot = this._quatDot(this.q, measured);
    if (dot < 0) {
      measured[0] = -measured[0];
      measured[1] = -measured[1];
      measured[2] = -measured[2];
      measured[3] = -measured[3];
    }

    const alpha = this.Q / (this.Q + this.R);
    this.q = this._slerp(this.q, measured, alpha);
    this._normalizeQuat(this.q);
  }

  getState() {
    return { q: [...this.q], angularVel: [...this.angularVel] };
  }

  reset(q = [0, 0, 0, 1], angVel = [0, 0, 0]) {
    this.q = [...q];
    this.angularVel = [...angVel];
    this._normalizeQuat(this.q);
  }

  _quatMultiply(q1, q2) {
    const [x1, y1, z1, w1] = q1;
    const [x2, y2, z2, w2] = q2;
    return [
      w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
      w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
      w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
      w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2
    ];
  }

  _quatDot(q1, q2) {
    return q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
  }

  _normalizeQuat(q) {
    const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
    if (len > 0) {
      q[0] /= len;
      q[1] /= len;
      q[2] /= len;
      q[3] /= len;
    }
  }

  _slerp(q1, q2, t) {
    let dot = this._quatDot(q1, q2);
    dot = Math.max(-1, Math.min(1, dot));
    const theta = Math.acos(dot);
    const sinTheta = Math.sin(theta);

    if (sinTheta < 1e-8) {
      return [
        q1[0] + t * (q2[0] - q1[0]),
        q1[1] + t * (q2[1] - q1[1]),
        q1[2] + t * (q2[2] - q1[2]),
        q1[3] + t * (q2[3] - q1[3])
      ];
    }

    const w1 = Math.sin((1 - t) * theta) / sinTheta;
    const w2 = Math.sin(t * theta) / sinTheta;
    return [
      w1 * q1[0] + w2 * q2[0],
      w1 * q1[1] + w2 * q2[1],
      w1 * q1[2] + w2 * q2[2],
      w1 * q1[3] + w2 * q2[3]
    ];
  }
}

export default KalmanFilterQuaternion;
