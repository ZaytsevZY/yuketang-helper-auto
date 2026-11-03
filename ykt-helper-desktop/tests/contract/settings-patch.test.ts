import { describe, expect, it } from 'vitest';
import { ErrorCode, YuketangError, assertSettingsPatch } from '@ykt/contracts';

const INVALID: unknown[] = [null, [], 'x', 42, true, {}, Object.create(null)];

describe('assertSettingsPatch', () => {
  it('接受包含布尔开关的补丁', () => {
    expect(() => assertSettingsPatch({ notifySound: false })).not.toThrow();
    expect(() =>
      assertSettingsPatch({ notifyProblems: true, autoJoinEnabled: false }),
    ).not.toThrow();
  });

  it.each(INVALID)('拒绝非普通对象或空补丁：%j', (value) => {
    // Object.create(null) 是普通对象但为空，同样应被拒绝。
    expect(() => assertSettingsPatch(value)).toThrowError(YuketangError);
  });

  it('拒绝未知设置项', () => {
    expect(() => assertSettingsPatch({ nope: true })).toThrowError(
      /未知设置项/,
    );
  });

  it.each(['aiProfiles', 'activeAiProfileId'])('拒绝保留设置项 %s', (key) => {
    const error = catchError({ [key]: 'x' });
    expect(error?.code).toBe(ErrorCode.InvalidArgument);
    expect(error?.message).toContain(key);
  });

  it('校验布尔类型', () => {
    const error = catchError({ notifySound: 'yes' });
    expect(error?.code).toBe(ErrorCode.InvalidArgument);
    expect(error?.message).toContain('notifySound');
  });

  it('校验字符串类型', () => {
    expect(catchError({ customNotifyAudioName: 1 })?.message).toContain(
      'customNotifyAudioName',
    );
    expect(() =>
      assertSettingsPatch({ customNotifyAudioSrc: 'C:/audio.wav' }),
    ).not.toThrow();
  });

  it('notifyVolume 接受 0..1 的数字', () => {
    expect(() => assertSettingsPatch({ notifyVolume: 0 })).not.toThrow();
    expect(() => assertSettingsPatch({ notifyVolume: 0.6 })).not.toThrow();
    expect(() => assertSettingsPatch({ notifyVolume: 1 })).not.toThrow();
  });

  it.each([-0.01, 1.01, 5, NaN, Infinity, '0.6', null])(
    'notifyVolume 拒绝 %j',
    (value) => {
      expect(catchError({ notifyVolume: value })?.code).toBe(
        ErrorCode.InvalidArgument,
      );
    },
  );

  it.each(['standard', 'pro', 'changjiang', null] as const)(
    'browserEnvironment 接受 %j',
    (value) => {
      expect(() =>
        assertSettingsPatch({ browserEnvironment: value }),
      ).not.toThrow();
    },
  );

  it('browserEnvironment 拒绝其他值', () => {
    expect(catchError({ browserEnvironment: 'staging' })?.code).toBe(
      ErrorCode.InvalidArgument,
    );
  });

  it('整数设置接受边界值、拒绝越界与小数', () => {
    expect(() =>
      assertSettingsPatch({
        notifyPopupDuration: 2000,
        autoAnswerDelay: 60000,
        autoAnswerRandomDelay: 0,
        maxPresentations: 50,
        cacheMaxBytes: 64 * 1024 * 1024,
        logRetentionDays: 365,
      }),
    ).not.toThrow();

    expect(catchError({ notifyPopupDuration: 1999 })?.message).toContain(
      'notifyPopupDuration',
    );
    expect(catchError({ autoAnswerDelay: 60001 })?.code).toBe(
      ErrorCode.InvalidArgument,
    );
    expect(catchError({ maxPresentations: 1.5 })?.message).toMatch(/整数/);
    expect(catchError({ cacheMaxBytes: '268435456' })?.code).toBe(
      ErrorCode.InvalidArgument,
    );
  });

  it('补丁中任一键非法即整体拒绝', () => {
    expect(() =>
      assertSettingsPatch({ notifySound: true, notifyVolume: 5 }),
    ).toThrowError(YuketangError);
  });
});

function catchError(patch: unknown): YuketangError | undefined {
  try {
    assertSettingsPatch(patch);
    return undefined;
  } catch (error) {
    return error as YuketangError;
  }
}
