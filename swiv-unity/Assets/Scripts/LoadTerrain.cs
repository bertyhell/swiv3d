using UnityEngine;

enum TerrainPosition {
    Left,
    Right,
    Top,
    Bottom
}

public class LoadTerrain : MonoBehaviour {
    [SerializeField] [Tooltip("Terrain that needs to be dynamically loaded")] GameObject terrainObject = null;
    [SerializeField] [Tooltip("Percentage from the edge to start loading the next terrain")] float margin = 0.3f;

    /**
     * first index is according to the z-axis
     * second index is according to the x-axis
     * the middle terrain is the one where the player is currently in
     **/
    private GameObject[] loadedTerrains = new GameObject[4];
    private float terrainWidth;
    private float terrainLength;

    void Start() {
        Terrain terrain = terrainObject.GetComponent<Terrain>();
        Vector3 terrainPos = terrain.GetPosition();

        // Load maximum 4 terrains at a time, then reuse them by moving them based on player position
        loadedTerrains[0] = terrainObject;
        loadedTerrains[1] = InstantiateTerrain(terrainObject, terrainPos, terrainPos.x - terrainWidth, terrainPos.z - terrainLength);
        loadedTerrains[2] = InstantiateTerrain(terrainObject, terrainPos, terrainPos.x - terrainWidth, terrainPos.z);
        loadedTerrains[3] = InstantiateTerrain(terrainObject, terrainPos, terrainPos.x, terrainPos.z - terrainLength);

        terrainWidth = terrain.terrainData.size.x;
        terrainLength = terrain.terrainData.size.z;
    }

    void Update() {
        DynamicallyLoadTerrains();
    }

    private void DynamicallyLoadTerrains() {
        // Get player position
        (TerrainPosition x, TerrainPosition z) playerPosition = GetPlayerQuadrant();

        // Indicates quadrant in which the player is flying over the current terrain
        int offsetX = playerPosition.x == TerrainPosition.Left ? -1 : 1;
        int offsetZ = playerPosition.z == TerrainPosition.Top ? -1 : 1; // Z-axis points up

        // Terrain position for terrain under the player
        Vector3 playerPos = transform.position;
        float currentTerrainX = Mathf.Floor(playerPos.x / terrainWidth) * terrainWidth;
        float currentTerrainZ = Mathf.Floor(playerPos.z / terrainLength) * terrainLength;

        // Update the positions of the 4 terrains to follow the player
        int[] offsetXs = { 0, offsetX };
        int[] offsetZs = { 0, offsetZ };
        int index = 0;
        foreach (int x in offsetXs) {
            foreach (int z in offsetZs) {
                loadedTerrains[index].transform.position = new Vector3(
                    currentTerrainX + terrainWidth * x,
                    loadedTerrains[index].transform.position.y,
                    currentTerrainZ + terrainLength * z
                );
                index++;
            }
        }

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

    private (TerrainPosition x, TerrainPosition z) GetPlayerQuadrant() {
        TerrainPosition playerXPosition;
        TerrainPosition playerZPosition;

        Vector3 playerPos = transform.position;
        float x = ((playerPos.x % terrainWidth) + terrainWidth) % terrainWidth;
        float z = ((playerPos.z % terrainLength) + terrainLength) % terrainLength;

        if (x > terrainWidth / 2) {
            playerXPosition = TerrainPosition.Right;
        } else {
            playerXPosition = TerrainPosition.Left;
        }

        if (z > terrainLength / 2) {
            playerZPosition = TerrainPosition.Bottom;
        } else {
            playerZPosition = TerrainPosition.Top;
        }

        return (x: playerXPosition, z: playerZPosition);
    }
}
