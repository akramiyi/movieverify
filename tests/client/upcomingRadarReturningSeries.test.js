import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  fetchServerUpcomingReleases,
  autoIngestUpcomingReleases,
} from '../../api/_lib/scheduledCampaignService.js';

test('Upcoming Radar Returning Web Series & Daily Soap Filtering Suite', async (t) => {
  const useTMDBPath = path.resolve('src/hooks/useTMDB.js');
  const useTMDBCode = fs.readFileSync(useTMDBPath, 'utf8');

  const scheduledServicePath = path.resolve('api/_lib/scheduledCampaignService.js');
  const scheduledServiceCode = fs.readFileSync(scheduledServicePath, 'utf8');

  const todayViewPath = path.resolve('src/components/TodayReleasesView.jsx');
  const todayViewCode = fs.readFileSync(todayViewPath, 'utf8');

  const campaignManagerPath = path.resolve('src/components/CampaignManager.jsx');
  const campaignManagerCode = fs.readFileSync(campaignManagerPath, 'utf8');

  await t.test('1. useTMDB.js queries TV using air_date.gte instead of first_air_date.gte to discover returning seasons', () => {
    assert.match(
      useTMDBCode,
      /\/discover\/tv\?with_original_language=\$\{lang\}&air_date\.gte=\$\{today\}&air_date\.lte=\$\{ninetyDaysFromNow\}/,
      'useTMDB must query TV discovery using air_date.gte to capture returning web series seasons'
    );
    assert.match(
      useTMDBCode,
      /without_genres=10766,10767,10763,10764/,
      'useTMDB must exclude soap, talk, news, and reality genres at discovery level'
    );
  });

  await t.test('2. scheduledCampaignService.js queries TV using air_date.gte for automated ingest', () => {
    assert.match(
      scheduledServiceCode,
      /\/discover\/tv\?with_original_language=hi&air_date\.gte=\$\{today\}&air_date\.lte=\$\{future\}/,
      'scheduledCampaignService must query Hindi TV with air_date.gte'
    );
    assert.match(
      scheduledServiceCode,
      /\/discover\/tv\?with_original_language=en&air_date\.gte=\$\{today\}&air_date\.lte=\$\{future\}/,
      'scheduledCampaignService must query Hollywood TV with air_date.gte'
    );
  });

  await t.test('3. Daily soap opera filter drops shows with >150 episodes or >50 next episode number', () => {
    assert.match(
      useTMDBCode,
      /show\.number_of_episodes > 150/,
      'useTMDB must drop shows with over 150 episodes'
    );
    assert.match(
      useTMDBCode,
      /next_episode_to_air\.episode_number > 50/,
      'useTMDB must drop shows whose next episode number is > 50'
    );
    assert.match(
      scheduledServiceCode,
      /show\.number_of_episodes > 150/,
      'scheduledCampaignService must drop shows with over 150 episodes'
    );
  });

  await t.test('4. Returning season formatting extracts season title and sets future season air date', () => {
    assert.match(
      useTMDBCode,
      /formattedTitle = `\$\{baseName\} - \$\{seasonName\}`/,
      'useTMDB must format returning series with "Title - Season X"'
    );
    assert.match(
      useTMDBCode,
      /target_season: seasonNum/,
      'useTMDB must assign target_season'
    );
    assert.match(
      useTMDBCode,
      /release_date: upcomingSeason\.air_date/,
      'useTMDB must assign release_date to the upcoming season air date'
    );
  });

  await t.test('5. TodayReleasesView and CampaignManager render season-specific badges and unique keys', () => {
    assert.match(
      todayViewCode,
      /item\.season_name \? `📺 \$\{item\.season_name\}` : '📺 Series'/,
      'TodayReleasesView must render season badge (e.g. 📺 Season 5)'
    );
    assert.match(
      todayViewCode,
      /key=\{`\$\{item\.media_type \|\| 'movie'\}_[^\`]+item\.target_season/,
      'TodayReleasesView must include target_season in key'
    );
    assert.match(
      campaignManagerCode,
      /item\.season_name \? `📺 \$\{item\.season_name\}` : '📺 Series'/,
      'CampaignManager must render season badge'
    );
    assert.match(
      campaignManagerCode,
      /season_number: item\.target_season \|\| 1/,
      'CampaignManager must pass target season to auto-schedule payload'
    );
  });

  await t.test('6. Simulated TV show resolution correctly identifies Panchayat Season 5 and drops soaps', () => {
    const today = '2026-11-19';
    const future = '2027-02-17';

    // Mock Panchayat TV show details from TMDB
    const panchayatDetails = {
      id: 101352,
      name: 'Panchayat',
      first_air_date: '2020-03-05',
      number_of_episodes: 33,
      number_of_seasons: 5,
      genres: [{ id: 35, name: 'Comedy' }, { id: 18, name: 'Drama' }],
      next_episode_to_air: {
        id: 8140869,
        name: 'Episode 1',
        air_date: '2026-12-03',
        episode_number: 1,
        season_number: 5,
      },
      seasons: [
        { season_number: 1, name: 'Season 1', air_date: '2020-03-05' },
        { season_number: 2, name: 'Season 2', air_date: '2022-05-18' },
        { season_number: 3, name: 'Season 3', air_date: '2024-05-28' },
        { season_number: 4, name: 'Season 4', air_date: '2025-06-24' },
        { season_number: 5, name: 'Season 5', air_date: '2026-12-03' },
      ],
    };

    // Mock Pushpa Impossible (Daily Soap)
    const soapDetails = {
      id: 203769,
      name: 'Pushpa Impossible',
      first_air_date: '2022-06-06',
      number_of_episodes: 1181,
      number_of_seasons: 1,
      genres: [{ id: 10766, name: 'Soap' }],
      next_episode_to_air: {
        air_date: '2026-11-20',
        episode_number: 1393,
        season_number: 1,
      },
    };

    function resolveReturningShow(show) {
      const isSoap =
        (show.number_of_episodes && show.number_of_episodes > 150) ||
        (show.next_episode_to_air && show.next_episode_to_air.episode_number > 50) ||
        (Array.isArray(show.genres) && show.genres.some((g) => [10766, 10767, 10763, 10764].includes(g.id)));

      if (isSoap) return null;

      let upcomingSeason = null;
      if (Array.isArray(show.seasons)) {
        upcomingSeason = show.seasons.find(
          (s) => s.season_number > 0 && s.air_date >= today && s.air_date <= future
        );
      }
      if (!upcomingSeason && show.next_episode_to_air && show.next_episode_to_air.air_date >= today && show.next_episode_to_air.air_date <= future) {
        upcomingSeason = {
          season_number: show.next_episode_to_air.season_number,
          name: `Season ${show.next_episode_to_air.season_number}`,
          air_date: show.next_episode_to_air.air_date,
        };
      }

      if (!upcomingSeason) return null;

      const seasonNum = upcomingSeason.season_number;
      const seasonName = upcomingSeason.name || `Season ${seasonNum}`;
      return {
        id: show.id,
        title: `${show.name} - ${seasonName}`,
        release_date: upcomingSeason.air_date,
        target_season: seasonNum,
        season_name: seasonName,
        media_type: 'tv',
      };
    }

    const resolvedPanchayat = resolveReturningShow(panchayatDetails);
    assert.ok(resolvedPanchayat, 'Panchayat Season 5 must be resolved successfully');
    assert.equal(resolvedPanchayat.title, 'Panchayat - Season 5');
    assert.equal(resolvedPanchayat.release_date, '2026-12-03');
    assert.equal(resolvedPanchayat.target_season, 5);
    assert.equal(resolvedPanchayat.season_name, 'Season 5');

    const resolvedSoap = resolveReturningShow(soapDetails);
    assert.equal(resolvedSoap, null, 'Daily soaps must be filtered out');
  });
});
