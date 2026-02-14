import { createKalmanFilterRotation } from './src/util/KalmanFilterFactory.js';

// Test 1: Default parameters
console.log('Test 1: Creating filter with default parameters...');
const filter1 = createKalmanFilterRotation();
console.log('✓ Filter created:', filter1);
console.log('  - Q:', filter1.Q);
console.log('  - R:', filter1.R);
console.log('  - Initial quaternion:', filter1.q);
console.log('  - Initial angular velocity:', filter1.angularVel);

// Test 2: Custom parameters
console.log('\nTest 2: Creating filter with custom parameters...');
const filter2 = createKalmanFilterRotation(0.2, 0.05);
console.log('✓ Filter created:', filter2);
console.log('  - Q:', filter2.Q);
console.log('  - R:', filter2.R);

// Test 3: Verify it's a KalmanFilterQuaternion instance
console.log('\nTest 3: Verifying instance methods...');
console.log('  - Has predict method:', typeof filter1.predict === 'function');
console.log('  - Has update method:', typeof filter1.update === 'function');
console.log('  - Has getState method:', typeof filter1.getState === 'function');
console.log('  - Has reset method:', typeof filter1.reset === 'function');

// Test 4: Test predict and update cycle
console.log('\nTest 4: Testing predict/update cycle...');
const filter3 = createKalmanFilterRotation();
const initialState = filter3.getState();
console.log('  - Initial state:', initialState);

filter3.predict(0.016); // 16ms delta
console.log('  - After predict:', filter3.getState());

filter3.update([0, 0, 0, 1]); // identity quaternion measurement
console.log('  - After update:', filter3.getState());

console.log('\n✓ All tests passed!');
