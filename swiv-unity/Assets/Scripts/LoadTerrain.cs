using UnityEngine;
using System;

enum TerrainPosition {
    Left,
    Right,
    Top,
    Bottom
}

public class LoadTerrain : MonoBehaviour {
    [SerializeField] [Tooltip("Terrain that needs to be dynamically loaded")] GameObject terrainObject = null;
    [SerializeField] [Tooltip("Percentage from the edge to start loading the next terrain")] float margin = 0.25f;

    private float terrainWidth;
    private float terrainLength;

    void Start() {
        Terrain terrain = terrainObject.GetComponent<Terrain>();

        terrainWidth = terrain.terrainData.size.x; // The terrain contains the map twice so we have seamless edges
        terrainLength = terrain.terrainData.size.z;
    }

    void Update() {
        DynamicallyLoadTerrains();
    }

    private void DynamicallyLoadTerrains() {
        // Get player position
        Tuple<int, int> playerPosition = GetPlayerQuadrant();

        // Terrain position for terrain under the player
        Vector3 playerPos = transform.position;
        float currentTerrainX = Mathf.Floor(playerPos.x / terrainWidth) * terrainWidth;
        float currentTerrainZ = Mathf.Floor(playerPos.z / terrainLength) * terrainLength;

        // Update the position of the terrain to follow the player
        terrainObject.transform.position = new Vector3(
            currentTerrainX + terrainWidth / 2 * playerPosition.Item1,
            terrainObject.transform.position.y,
            currentTerrainZ + terrainLength / 2 * playerPosition.Item2
        );
    }

    private GameObject InstantiateTerrain(GameObject terrain, Vector3 pos, float x, float z) {
        return Instantiate(
            terrain,
            new Vector3(
                x,
                pos.y,
                z
            ),
            Quaternion.identity
        );
    }

    private Tuple<int, int> GetPlayerQuadrant() {
        int offsetX;
        int offsetZ;

        Vector3 playerPos = transform.position;
        float x = ((playerPos.x % terrainWidth) + terrainWidth) % terrainWidth;
        float z = ((playerPos.z % terrainLength) + terrainLength) % terrainLength;

        if (x > terrainWidth * (1f - margin)) {
            offsetX = 1;
        } else if (x < terrainWidth * margin) {
            offsetX = -1;
        } else {
            offsetX = 0;
        }

        if (z > terrainLength * (1f - margin)) {
            offsetZ = 1;
        } else if (z < terrainLength * margin) {
            offsetZ = -1;
        } else {
            offsetZ = 0;
        }

        return new Tuple<int, int>(offsetX, offsetZ);
    }
}
