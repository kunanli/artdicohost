import test from 'node:test';
import assert from 'node:assert/strict';
import {createMosaicOrder} from '../src/lib/home-collections.mjs';

test('each new page shuffles once with linear draws and does not change publication input',()=>{
 let calls=0;const order=createMosaicOrder(()=>{calls++;return 0;}),input=['a','b','c','d'];
 assert.deepEqual(order(input),['b','c','d','a']);assert.equal(calls,3);assert.deepEqual(input,['a','b','c','d']);
 assert.deepEqual(order(input.toReversed()),['b','c','d','a']);assert.equal(calls,3);
 assert.deepEqual(createMosaicOrder(()=>.999)(input),input);
});
test('filters keep page order and refreshes add new IDs without moving existing work',()=>{
 let calls=0;const order=createMosaicOrder(()=>{calls++;return 0;});assert.deepEqual(order([]),[]);assert.equal(calls,0);
 order(['a','b','c']);assert.deepEqual(order(['c','b','a'],['a','c']),['c','a']);assert.equal(calls,2);
 assert.deepEqual(order(['a','b','c','d','e']),['b','c','a','e','d']);assert.equal(calls,3);
 assert.deepEqual(order(['a','c','e']),['c','a','e']);assert.equal(calls,3);
});
