import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

@Injectable()
class Dep {
  value = 42;
}

@Injectable()
class Consumer {
  constructor(readonly dep: Dep) {}
}

describe('transformer tes', () => {
  it('memancarkan metadata decorator sehingga DI NestJS bekerja tanpa @Inject eksplisit', async () => {
    const ref = await Test.createTestingModule({ providers: [Dep, Consumer] }).compile();
    expect(ref.get(Consumer).dep.value).toBe(42);
  });
});
