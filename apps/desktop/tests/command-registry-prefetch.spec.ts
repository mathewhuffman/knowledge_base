import { test, expect } from '@playwright/test';
import { __commandRegistryTestables } from '../src/main/services/command-registry';

test.describe('command registry planner prefetch clustering', () => {
  test('splits food list PBIs into distinct workflow clusters instead of one giant generic cluster', () => {
    const uploadedPbis = {
      rows: [
        {
          id: 'pbi-1',
          title: 'Food List',
          title1: 'Food List',
          title2: 'Navigating to Food List',
          title3: ''
        },
        {
          id: 'pbi-2',
          title: 'Food List',
          title1: 'Food List',
          title2: 'Searching Food List Table',
          title3: ''
        },
        {
          id: 'pbi-3',
          title: 'Food List',
          title1: 'Food List',
          title2: 'Filters & Sorts',
          title3: ''
        },
        {
          id: 'pbi-4',
          title: 'Food Lists',
          title1: 'Food Lists',
          title2: 'Details Tab',
          title3: ''
        },
        {
          id: 'pbi-5',
          title: 'Edit Food List Title',
          title1: 'Edit Food List Title',
          title2: '',
          title3: ''
        },
        {
          id: 'pbi-6',
          title: 'Food Lists',
          title1: 'Food Lists',
          title2: 'Location Tab Visibility and Navigation',
          title3: ''
        },
        {
          id: 'pbi-7',
          title: 'Duplicating Food Item',
          title1: 'Duplicating Food Item',
          title2: '',
          title3: ''
        },
        {
          id: 'pbi-8',
          title: 'Duplicating Food List',
          title1: 'Duplicating Food List',
          title2: '',
          title3: ''
        }
      ]
    };

    const clusters = __commandRegistryTestables.buildPlannerTopicClusters(uploadedPbis);

    expect(clusters.map((cluster) => cluster.label)).toEqual(expect.arrayContaining([
      'View Food Lists',
      'View and Edit a Food List',
      'Duplicate a Food Item',
      'Duplicate a Food List'
    ]));

    expect(clusters.find((cluster) => cluster.label === 'View Food Lists')?.pbiIds).toEqual(
      expect.arrayContaining(['pbi-1', 'pbi-2', 'pbi-3'])
    );
    expect(clusters.find((cluster) => cluster.label === 'View and Edit a Food List')?.pbiIds).toEqual(
      expect.arrayContaining(['pbi-4', 'pbi-5', 'pbi-6'])
    );
  });

  test('keeps direct edit-surface queries for list index and detail workflows', () => {
    const uploadedPbis = {
      rows: [
        {
          id: 'pbi-1',
          title: 'Food List',
          title1: 'Food List',
          title2: 'Navigating to Food List',
          title3: ''
        },
        {
          id: 'pbi-2',
          title: 'Food List',
          title1: 'Food List',
          title2: 'Searching Food List Table',
          title3: ''
        },
        {
          id: 'pbi-3',
          title: 'Food Lists',
          title1: 'Food Lists',
          title2: 'Details Tab',
          title3: ''
        },
        {
          id: 'pbi-4',
          title: 'Edit Food List Title',
          title1: 'Edit Food List Title',
          title2: '',
          title3: ''
        }
      ]
    };

    const clusters = __commandRegistryTestables.buildPlannerTopicClusters(uploadedPbis);
    const listIndexCluster = clusters.find((cluster) => cluster.label === 'View Food Lists');
    const detailCluster = clusters.find((cluster) => cluster.label === 'View and Edit a Food List');

    expect(listIndexCluster?.queries).toEqual(expect.arrayContaining([
      'View Food Lists',
      'Navigating to Food List',
      'Searching Food List Table'
    ]));
    expect(detailCluster?.queries).toEqual(expect.arrayContaining([
      'View and Edit a Food List',
      'Edit Food List Title',
      'Details Tab'
    ]));
  });
});
