#!/bin/bash

# W4-020: Jump Dynamics Test Suite (60 TPS)
# Runs three complementary tests to verify jump physics

echo "============================================"
echo "W4-020: Jump Dynamics Test Suite (60 TPS)"
echo "============================================"
echo ""

TESTS_PASSED=0
TESTS_FAILED=0

# Test 1: Pure Math
echo "Test 1/3: Pure Jump Physics Math (No Dependencies)"
echo "----------------------------------------------------"
node test-jump-math.js
if [ $? -eq 0 ]; then
  echo "✓ Math test PASSED"
  ((TESTS_PASSED++))
else
  echo "✗ Math test FAILED"
  ((TESTS_FAILED++))
fi

echo ""
echo ""

# Test 2: Integration Test (Primary)
echo "Test 2/3: Jump Dynamics Integration (Jolt Physics)"
echo "---------------------------------------------------"
node test-jump-integration.js
if [ $? -eq 0 ]; then
  echo "✓ Integration test PASSED"
  ((TESTS_PASSED++))
else
  echo "✗ Integration test FAILED"
  ((TESTS_FAILED++))
fi

echo ""
echo ""

# Test 3: Alternative Integration
echo "Test 3/3: Alternative Physics Integration"
echo "------------------------------------------"
node test-jump-physics.js
if [ $? -eq 0 ]; then
  echo "✓ Physics test PASSED"
  ((TESTS_PASSED++))
else
  echo "✗ Physics test FAILED"
  ((TESTS_FAILED++))
fi

echo ""
echo "============================================"
echo "Test Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
echo "============================================"

if [ $TESTS_FAILED -eq 0 ]; then
  echo "✓ W4-020: ALL TESTS PASSED"
  exit 0
else
  echo "✗ W4-020: SOME TESTS FAILED"
  exit 1
fi
