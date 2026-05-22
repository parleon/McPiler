import { describe, expect, it } from 'vitest';

import { checkNameCollisions, toClassName, toMethodName, toTypeName } from './names.js';

describe('emitter names', () => {
  it('e-03: snake_case → camelCase method names', () => {
    expect(toMethodName('get_weather')).toBe('getWeather');
  });

  it('e-13: reserved word → prefixed with $', () => {
    expect(toMethodName('delete')).toBe('$delete');
  });

  it('e-14: hyphens/special chars → valid camelCase', () => {
    expect(toMethodName('get-weather!now')).toBe('getWeatherNow');
  });

  it('e-15: two operations normalize to same name → throws collision error', () => {
    expect(() => checkNameCollisions(['get-weather', 'get_weather'])).toThrow(
      'Operation name collision after normalization: getWeather <= "get-weather", "get_weather"',
    );
  });

  it('e-20: scoped package name → class name derived from local name only', () => {
    expect(toClassName('@foo/my-mcp')).toBe('MyMcp');
  });

  it('prefixes method names that start with digits', () => {
    expect(toMethodName('123abc')).toBe('op_123abc');
  });

  it('derives PascalCase type names', () => {
    expect(toTypeName('get_weather')).toBe('GetWeather');
    expect(toTypeName('run-query!now')).toBe('RunQueryNow');
  });

  it('derives class names from various package formats', () => {
    expect(toClassName('weather-client')).toBe('WeatherClient');
    expect(toClassName('weather_client')).toBe('WeatherClient');
    expect(toClassName('weather.client')).toBe('WeatherClient');
  });
});
